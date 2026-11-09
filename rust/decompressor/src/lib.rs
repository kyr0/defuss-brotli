//! Streaming Brotli decompression behind `defuss-brotli/decompressor`.
//!
//! VERIFIED: driving `BrotliDecompressStream` directly instead of `Decompressor` + `io::copy` drops the `std::io`
//! adapters; before wasm-opt the binary is 15,793 B smaller.
//!
//! On wasm32 the crate is `no_std`: an abort-only panic handler and an arena allocator (`runtime`) replace std's
//! panic formatting and dlmalloc. VERIFIED: that took the whole-buffer decoder from 52,950 B to 48,608 B
//! brotli-compressed with decode speed within noise, where keeping dlmalloc under `no_std` reached only 51,364 B;
//! the chunked decoder is 48,973 B (ARCH.md, "Why this design").
#![cfg_attr(target_arch = "wasm32", no_std)]
#![deny(unsafe_code)]

extern crate alloc;

use alloc::{boxed::Box, vec, vec::Vec};
use brotli_decompressor::{
    Allocator, BrotliDecompressStream, BrotliResult, BrotliState, SliceWrapper, SliceWrapperMut,
};
use wasm_bindgen::prelude::*;

#[cfg(target_arch = "wasm32")]
mod runtime;

/// Decoder memory as boxed slices, so the crate needs only `alloc`: `alloc-stdlib`'s `StandardAlloc` requires std.
#[derive(Default)]
struct Heap<T>(Box<[T]>);

impl<T> SliceWrapper<T> for Heap<T> {
    fn slice(&self) -> &[T] {
        &self.0
    }
}

impl<T> SliceWrapperMut<T> for Heap<T> {
    fn slice_mut(&mut self) -> &mut [T] {
        &mut self.0
    }
}

/// Zero-initialized allocations, as `StandardAlloc` makes them; freeing is dropping the box.
#[derive(Default)]
struct BoxAlloc;

impl<T: Clone + Default> Allocator<T> for BoxAlloc {
    type AllocatedMemory = Heap<T>;
    fn alloc_cell(&mut self, len: usize) -> Heap<T> {
        Heap(vec![T::default(); len].into_boxed_slice())
    }
    fn free_cell(&mut self, _data: Heap<T>) {}
}

/// Largest input and output chunk. VERIFIED: on the 100 MiB text (Node.js 26, three interleaved rounds), 256 KiB
/// took 161-168 ms and 18.1 MiB of WASM memory, 1 MiB 153-158 ms and 19.6 MiB, 4 MiB 148-162 ms and 25.6 MiB.
pub const CHUNK: usize = 1 << 20;

/// Smallest output chunk, so small inputs that expand far (repetitive text) need few steps.
const MIN_OUTPUT_CHUNK: usize = 64 * 1024;

/// A streaming decoder over two fixed buffers that JavaScript reads and writes in WASM memory: it copies each
/// compressed chunk into [`Decoder::input_mut`], calls [`Decoder::decode`] and copies the decoded bytes out of
/// [`Decoder::output`]. Linear memory then holds the decoder state and two chunks whatever the payload size.
/// WASM memory grows but never shrinks, and a whole-buffer call kept its peak for the life of the instance
/// (VERIFIED: 283 MiB after one 100 MiB decode, bench/large.mjs before this design).
#[wasm_bindgen]
pub struct Decoder {
    state: BrotliState<BoxAlloc, BoxAlloc, BoxAlloc>,
    input: Box<[u8]>,
    output: Box<[u8]>,
    available_in: usize,
    input_offset: usize,
    remaining_out: usize,
    finished: bool,
}

impl Decoder {
    /// A decoder for `input_len` compressed bytes that fails once the output would exceed `max_output_size`.
    /// Chunks are at most [`CHUNK`]; the output chunk starts at 4x the input, as the whole buffer did before.
    pub fn new(input_len: usize, max_output_size: usize) -> Result<Self, &'static str> {
        if max_output_size == 0 {
            return Err("max_output_size must be > 0");
        }
        let output_len = input_len.saturating_mul(4).clamp(MIN_OUTPUT_CHUNK, CHUNK);
        Ok(Self {
            state: BrotliState::new(BoxAlloc, BoxAlloc, BoxAlloc),
            input: vec![0; input_len.min(CHUNK)].into_boxed_slice(),
            output: vec![0; output_len.min(max_output_size)].into_boxed_slice(),
            available_in: 0,
            input_offset: 0,
            remaining_out: max_output_size,
            finished: false,
        })
    }

    pub fn input_mut(&mut self) -> &mut [u8] {
        &mut self.input
    }

    pub fn output(&self) -> &[u8] {
        &self.output
    }

    /// Decodes the first `len` bytes of the input buffer, which may be refilled only once [`Decoder::needs_input`]
    /// is true, or with `len == 0` continues with the unconsumed rest,
    /// until the output buffer is full, the input is consumed or the stream ends. `last` marks the final chunk.
    /// Returns how many decoded bytes are now at the start of the output buffer. An output of exactly
    /// `max_output_size` is accepted (test `output_of_exactly_max_size_is_accepted`); bytes after the end of the
    /// stream are an error, as in `brotli_decompressor::Decompressor`.
    pub fn decode(&mut self, len: usize, last: bool) -> Result<usize, &'static str> {
        if len > 0 {
            if len > self.input.len() {
                return Err("input chunk exceeds the input buffer");
            }
            self.available_in = len;
            self.input_offset = 0;
        }
        let mut available_out = self.output.len().min(self.remaining_out);
        let mut written = 0;
        let mut total_out = 0;
        let result = BrotliDecompressStream(
            &mut self.available_in,
            &mut self.input_offset,
            &self.input,
            &mut available_out,
            &mut written,
            &mut self.output,
            &mut total_out,
            &mut self.state,
        );
        self.remaining_out -= written;
        match result {
            BrotliResult::ResultSuccess if self.available_in == 0 && last => {
                self.finished = true;
                Ok(written)
            }
            BrotliResult::ResultSuccess => Err("trailing data after brotli stream"),
            BrotliResult::NeedsMoreOutput if self.remaining_out == 0 => {
                Err("decompressed data exceeds max_output_size")
            }
            BrotliResult::NeedsMoreInput if last => Err("truncated brotli stream"),
            BrotliResult::NeedsMoreOutput | BrotliResult::NeedsMoreInput => Ok(written),
            BrotliResult::ResultFailure => Err("invalid brotli stream"),
        }
    }
}

/// The JavaScript side of [`Decoder`]: buffer addresses instead of slices, `Error`s instead of strings.
#[wasm_bindgen]
impl Decoder {
    #[wasm_bindgen(constructor)]
    pub fn create(input_len: usize, max_output_size: usize) -> Result<Decoder, JsError> {
        Self::new(input_len, max_output_size).map_err(JsError::new)
    }

    pub fn input_ptr(&mut self) -> *mut u8 {
        self.input.as_mut_ptr()
    }

    pub fn input_capacity(&self) -> usize {
        self.input.len()
    }

    pub fn output_ptr(&self) -> *const u8 {
        self.output.as_ptr()
    }

    #[wasm_bindgen(js_name = decode)]
    pub fn decode_js(&mut self, len: usize, last: bool) -> Result<usize, JsError> {
        self.decode(len, last).map_err(JsError::new)
    }

    /// True once the input buffer is consumed and may be refilled.
    pub fn needs_input(&self) -> bool {
        self.available_in == 0
    }

    pub fn finished(&self) -> bool {
        self.finished
    }
}

/// Decompresses `input` in [`CHUNK`]-sized steps, the way the JavaScript entry points drive a [`Decoder`].
pub fn decompress(input: &[u8], max_output_size: usize) -> Result<Vec<u8>, &'static str> {
    let mut decoder = Decoder::new(input.len(), max_output_size)?;
    let mut output = Vec::new();
    let mut offset = 0;
    while !decoder.finished() {
        let mut len = 0;
        if decoder.needs_input() {
            len = decoder.input_mut().len().min(input.len() - offset);
            decoder.input_mut()[..len].copy_from_slice(&input[offset..offset + len]);
            offset += len;
        }
        let written = decoder.decode(len, offset == input.len())?;
        output.extend_from_slice(&decoder.output()[..written]);
    }
    Ok(output)
}

#[cfg(test)]
mod tests {
    use super::decompress;

    fn compress(data: &[u8]) -> Vec<u8> {
        let mut out = Vec::new();
        let params = brotli::enc::BrotliEncoderParams::default();
        brotli::BrotliCompress(&mut &data[..], &mut out, &params).unwrap();
        out
    }

    // JavaScript writes at input_ptr and reads at output_ptr: they must be the buffers decode() uses. The wrappers'
    // error paths need a JS host (src/*.test.ts).
    #[test]
    fn javascript_wrappers_expose_the_decode_buffers() {
        let packed = compress(b"wrapped");
        let mut decoder = super::Decoder::create(packed.len(), 64).unwrap();
        assert_eq!(decoder.input_capacity(), packed.len());
        assert_eq!(decoder.input_ptr(), decoder.input_mut().as_mut_ptr());
        decoder.input_mut().copy_from_slice(&packed);
        assert!(decoder.needs_input());
        let written = decoder.decode_js(packed.len(), true).unwrap();
        assert_eq!(decoder.output_ptr(), decoder.output().as_ptr());
        assert_eq!(&decoder.output()[..written], b"wrapped");
        assert!(decoder.finished());
    }

    #[test]
    fn round_trips_empty_and_large_output() {
        assert_eq!(decompress(&compress(b""), 1).unwrap(), b"");
        let big = b"abcdefghij".repeat(100_000);
        assert_eq!(decompress(&compress(&big), usize::MAX).unwrap(), big);
    }

    #[test]
    fn output_of_exactly_max_size_is_accepted() {
        let data = b"0123456789".repeat(20_000);
        let packed = compress(&data);
        assert_eq!(decompress(&packed, data.len()).unwrap(), data);
        assert_eq!(
            decompress(&packed, data.len() - 1),
            Err("decompressed data exceeds max_output_size")
        );
    }

    /// Deterministic incompressible bytes (xorshift): their Brotli stream spans several input chunks.
    fn noise(len: usize) -> Vec<u8> {
        let mut x: u32 = 0x9e37_79b9;
        (0..len)
            .map(|_| {
                x ^= x << 13;
                x ^= x >> 17;
                x ^= x << 5;
                x as u8
            })
            .collect()
    }

    #[test]
    fn decodes_across_input_and_output_chunks() {
        let data = noise(3 * super::CHUNK + 12_345);
        let packed = compress(&data);
        assert!(packed.len() > 2 * super::CHUNK);
        assert_eq!(decompress(&packed, usize::MAX).unwrap(), data);
    }

    #[test]
    fn exact_max_size_on_an_output_chunk_boundary_is_accepted() {
        let data = b"0123456789abcdef".repeat(4 * 65536 / 16);
        let packed = compress(&data);
        assert_eq!(decompress(&packed, data.len()).unwrap(), data);
        assert_eq!(
            decompress(&packed, data.len() - 1),
            Err("decompressed data exceeds max_output_size")
        );
    }

    #[test]
    fn rejects_oversized_chunks_and_streams_that_end_before_the_last_chunk() {
        let packed = compress(b"chunked");
        let mut decoder = super::Decoder::new(packed.len(), 64).unwrap();
        assert!(decoder.decode(packed.len() + 1, true).is_err());
        decoder.input_mut().copy_from_slice(&packed);
        assert_eq!(
            decoder.decode(packed.len(), false),
            Err("trailing data after brotli stream")
        );
    }

    #[test]
    fn rejects_truncated_trailing_and_corrupt_input() {
        let packed = compress(&b"hello brotli ".repeat(1000));
        assert!(decompress(&packed[..packed.len() - 1], usize::MAX).is_err());
        let mut trailing = packed.clone();
        trailing.push(0);
        assert!(decompress(&trailing, usize::MAX).is_err());
        assert!(decompress(&[0xff; 64], usize::MAX).is_err());
        assert!(decompress(&packed, 0).is_err());
    }
}
