//! Whole-buffer Brotli compression behind `defuss-brotli/compressor`.
//!
//! VERIFIED: one `BROTLI_OPERATION_FINISH` call over the whole input replaces `CompressorReader` with a 4 KiB
//! buffer, which made qualities 0-1 compress each 4 KiB chunk as an independent fragment (28 KiB HTML at
//! quality 1: 3,853 B before, 1,189 B after; test `fast_qualities_match_across_4k_chunks`).
#![forbid(unsafe_code)]

use brotli::enc::encode::{
    BrotliEncoderOperation, BrotliEncoderParameter, BrotliEncoderStateStruct,
};
use brotli::enc::StandardAlloc;
use wasm_bindgen::prelude::*;

/// Largest output chunk. Input chunks are one window (`1 << lgwin`, see [`Encoder::new`]).
pub const CHUNK: usize = 1 << 20;

/// A streaming encoder over two fixed buffers that JavaScript reads and writes in WASM memory, as the decoder's
/// `Decoder`: linear memory holds the encoder state, one window of input and one output chunk instead of the
/// whole input and a growing output. VERIFIED: the output is byte-identical to one `BROTLI_OPERATION_FINISH` call
/// over the whole input for every quality (test `chunked_output_matches_one_finish_call`).
#[wasm_bindgen]
pub struct Encoder {
    state: BrotliEncoderStateStruct<StandardAlloc>,
    input: Box<[u8]>,
    output: Box<[u8]>,
    available_in: usize,
    input_offset: usize,
}

impl Encoder {
    /// An encoder for `input_len` bytes. Input chunks are exactly one window: qualities 0-1 compress each call's
    /// input in blocks of at most one window, so smaller chunks would split blocks that one call keeps whole.
    /// The output chunk starts at half the input plus 1 KiB, as the whole buffer did before, up to [`CHUNK`].
    pub fn new(input_len: usize, quality: u32, lgwin: u32) -> Result<Self, &'static str> {
        if quality > 11 {
            return Err("quality must be between 0 and 11");
        }
        if !(10..=24).contains(&lgwin) {
            return Err("lgwin must be between 10 and 24");
        }
        let mut state = BrotliEncoderStateStruct::new(StandardAlloc::default());
        state.set_parameter(BrotliEncoderParameter::BROTLI_PARAM_QUALITY, quality);
        state.set_parameter(BrotliEncoderParameter::BROTLI_PARAM_LGWIN, lgwin);
        state.set_parameter(
            BrotliEncoderParameter::BROTLI_PARAM_SIZE_HINT,
            u32::try_from(input_len).unwrap_or(u32::MAX),
        );
        Ok(Self {
            state,
            input: vec![0; input_len.min(1 << lgwin)].into_boxed_slice(),
            output: vec![0; (input_len / 2 + 1024).min(CHUNK)].into_boxed_slice(),
            available_in: 0,
            input_offset: 0,
        })
    }

    pub fn input_mut(&mut self) -> &mut [u8] {
        &mut self.input
    }

    pub fn output(&self) -> &[u8] {
        &self.output
    }

    /// Compresses the first `len` bytes of the input buffer, which may be refilled only once
    /// [`Encoder::needs_input`] is true, or with `len == 0` continues with the unconsumed rest, until the output
    /// buffer is full or the input is consumed; `last` finishes the stream. Returns how many compressed bytes are
    /// now at the start of the output buffer.
    pub fn encode(&mut self, len: usize, last: bool) -> Result<usize, &'static str> {
        if len > 0 {
            if len > self.input.len() {
                return Err("input chunk exceeds the input buffer");
            }
            self.available_in = len;
            self.input_offset = 0;
        }
        let op = if last {
            BrotliEncoderOperation::BROTLI_OPERATION_FINISH
        } else {
            BrotliEncoderOperation::BROTLI_OPERATION_PROCESS
        };
        let mut available_out = self.output.len();
        let mut written = 0;
        let mut total_out = None;
        if !self.state.compress_stream(
            op,
            &mut self.available_in,
            &self.input,
            &mut self.input_offset,
            &mut available_out,
            &mut self.output,
            &mut written,
            &mut total_out,
            &mut |_, _, _, _| (),
        ) {
            return Err("brotli encoder failed");
        }
        Ok(written)
    }

    pub fn finished(&self) -> bool {
        self.state.is_finished()
    }
}

/// The JavaScript side of [`Encoder`]: buffer addresses instead of slices, `Error`s instead of strings.
#[wasm_bindgen]
impl Encoder {
    #[wasm_bindgen(constructor)]
    pub fn create(input_len: usize, quality: u32, lgwin: u32) -> Result<Encoder, JsError> {
        Self::new(input_len, quality, lgwin).map_err(JsError::new)
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

    #[wasm_bindgen(js_name = encode)]
    pub fn encode_js(&mut self, len: usize, last: bool) -> Result<usize, JsError> {
        self.encode(len, last).map_err(JsError::new)
    }

    /// True once the input buffer is consumed and may be refilled.
    pub fn needs_input(&self) -> bool {
        self.available_in == 0
    }

    #[wasm_bindgen(js_name = finished)]
    pub fn finished_js(&self) -> bool {
        self.finished()
    }
}

/// Compresses `input` chunk by chunk, the way the JavaScript entry points drive an [`Encoder`].
pub fn compress(input: &[u8], quality: u32, lgwin: u32) -> Result<Vec<u8>, &'static str> {
    let mut encoder = Encoder::new(input.len(), quality, lgwin)?;
    let mut output = Vec::new();
    let mut offset = 0;
    while !encoder.finished() {
        let mut len = 0;
        if encoder.needs_input() {
            len = encoder.input_mut().len().min(input.len() - offset);
            encoder.input_mut()[..len].copy_from_slice(&input[offset..offset + len]);
            offset += len;
        }
        let written = encoder.encode(len, offset == input.len())?;
        output.extend_from_slice(&encoder.output()[..written]);
    }
    Ok(output)
}

#[cfg(test)]
mod tests {
    use super::compress;

    fn decompress(data: &[u8]) -> Vec<u8> {
        let mut out = Vec::new();
        brotli::BrotliDecompress(&mut &data[..], &mut out).expect("valid brotli stream");
        out
    }

    /// Deterministic incompressible bytes (xorshift), so only cross-block matches can shrink them.
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
    fn round_trips_every_quality() {
        let text = b"The quick brown fox jumps over the lazy dog. ".repeat(500);
        for input in [&b""[..], &text[..], &noise(70_000)[..]] {
            for quality in 0..=11 {
                let packed = compress(input, quality, 22).unwrap();
                assert_eq!(decompress(&packed), input, "quality {quality}");
            }
        }
    }

    // Regression: a 4 KiB streaming buffer made quality 0-1 encode each 4 KiB chunk as its own
    // fragment, so repeats across chunks were never matched.
    #[test]
    fn fast_qualities_match_across_4k_chunks() {
        let block = noise(4096);
        let input: Vec<u8> = block.iter().copied().cycle().take(8 * 4096).collect();
        for quality in [0, 1] {
            let packed = compress(&input, quality, 22).unwrap();
            assert!(
                packed.len() < 2 * 4096,
                "quality {quality}: {} bytes",
                packed.len()
            );
        }
    }

    /// The previous whole-buffer encoder: one FINISH call over all input with room for all output.
    fn one_finish_call(input: &[u8], quality: u32, lgwin: u32) -> Vec<u8> {
        use brotli::enc::encode::{
            BrotliEncoderOperation, BrotliEncoderParameter, BrotliEncoderStateStruct,
        };
        let mut state = BrotliEncoderStateStruct::new(brotli::enc::StandardAlloc::default());
        state.set_parameter(BrotliEncoderParameter::BROTLI_PARAM_QUALITY, quality);
        state.set_parameter(BrotliEncoderParameter::BROTLI_PARAM_LGWIN, lgwin);
        state.set_parameter(
            BrotliEncoderParameter::BROTLI_PARAM_SIZE_HINT,
            input.len() as u32,
        );
        let mut output = vec![0; 2 * input.len() + 1024];
        let (mut available_in, mut input_offset, mut output_offset) = (input.len(), 0, 0);
        let mut available_out = output.len();
        assert!(state.compress_stream(
            BrotliEncoderOperation::BROTLI_OPERATION_FINISH,
            &mut available_in,
            input,
            &mut input_offset,
            &mut available_out,
            &mut output,
            &mut output_offset,
            &mut None,
            &mut |_, _, _, _| (),
        ));
        assert!(state.is_finished());
        output.truncate(output_offset);
        output
    }

    // lgwin 10 makes 1 KiB input chunks, so 70 KB of text and noise span many input and output chunks.
    #[test]
    fn chunked_output_matches_one_finish_call() {
        let mut input = b"<li>chunked brotli streams</li>".repeat(1200);
        input.extend(noise(35_000));
        for quality in 0..=11 {
            for lgwin in [10, 16, 22] {
                assert_eq!(
                    compress(&input, quality, lgwin).unwrap(),
                    one_finish_call(&input, quality, lgwin),
                    "quality {quality} lgwin {lgwin}"
                );
            }
        }
    }

    // JavaScript writes at input_ptr and reads at output_ptr: they must be the buffers encode() uses. The wrappers'
    // error paths need a JS host (src/*.test.ts).
    #[test]
    fn javascript_wrappers_expose_the_encode_buffers() {
        let mut encoder = super::Encoder::create(7, 5, 22).unwrap();
        assert_eq!(encoder.input_capacity(), 7);
        assert_eq!(encoder.input_ptr(), encoder.input_mut().as_mut_ptr());
        encoder.input_mut().copy_from_slice(b"wrapped");
        assert!(encoder.needs_input());
        let written = encoder.encode_js(7, true).unwrap();
        assert_eq!(encoder.output_ptr(), encoder.output().as_ptr());
        assert!(encoder.finished_js());
        assert_eq!(decompress(&encoder.output()[..written]), b"wrapped");
    }

    #[test]
    fn rejects_input_chunks_larger_than_the_input_buffer() {
        let mut encoder = super::Encoder::new(4, 5, 22).unwrap();
        assert!(encoder.encode(5, true).is_err());
    }

    #[test]
    fn grows_output_beyond_initial_estimate() {
        let input = noise(100_000);
        let packed = compress(&input, 5, 22).unwrap();
        assert!(packed.len() > input.len() / 2 + 1024);
        assert_eq!(decompress(&packed), input);
    }

    #[test]
    fn rejects_out_of_range_parameters() {
        assert!(compress(b"x", 12, 22).is_err());
        assert!(compress(b"x", 6, 9).is_err());
        assert!(compress(b"x", 6, 25).is_err());
    }
}
