//! wasm32 runtime for the `no_std` decoder: an abort-only panic handler and the global allocator.
//! The only `unsafe` code in the crate lives here.
#![allow(unsafe_code)]

use core::alloc::{GlobalAlloc, Layout};
use core::arch::wasm32;
use core::cell::Cell;
use core::ptr;

const PAGE: usize = 64 * 1024;

/// A bump allocator that rewinds to its base whenever no allocation is live.
///
/// Each `decompress` call from JavaScript allocates a `Decoder` (its state and two chunk buffers) and frees it in a
/// `finally` block, so between calls nothing is live and the next call reuses the same memory. Within a call only
/// the most recent block is reused or grown in place. VERIFIED: 1,100 rounds of valid, over-limit and truncated
/// calls do not grow memory (src/decompressor.test.ts), and decoding 100 MiB of text or a 100 MB file, both over
/// many metablocks, stays at 19.6 MiB (bench/large.mjs).
struct Arena {
    base: Cell<usize>,
    next: Cell<usize>,
    end: Cell<usize>,
    live: Cell<usize>,
}

// SAFETY: wasm32-unknown-unknown without the `atomics` target feature runs exactly one thread.
unsafe impl Sync for Arena {}

impl Arena {
    /// Makes addresses below `top` usable, growing linear memory by whole pages; false when memory is exhausted.
    fn reserve(&self, top: usize) -> bool {
        if self.end.get() == 0 {
            // Start above everything the linker placed in memory (data, stack, wasm-bindgen's statics).
            let start = wasm32::memory_size(0) * PAGE;
            self.base.set(start);
            self.next.set(start);
            self.end.set(start);
        }
        if top <= self.end.get() {
            return true;
        }
        let pages = (top - self.end.get()).div_ceil(PAGE);
        // 4 GiB of memory ends at 2^32, one past the 32-bit usize range: never grow into the last page.
        let Some(end) = pages
            .checked_mul(PAGE)
            .and_then(|bytes| self.end.get().checked_add(bytes))
        else {
            return false;
        };
        if wasm32::memory_grow(0, pages) == usize::MAX {
            return false;
        }
        self.end.set(end);
        true
    }

    fn bump(&self, layout: Layout) -> *mut u8 {
        if !self.reserve(0) {
            return ptr::null_mut();
        }
        let Some(padded) = self.next.get().checked_add(layout.align() - 1) else {
            return ptr::null_mut();
        };
        let start = padded & !(layout.align() - 1);
        match start.checked_add(layout.size()) {
            Some(top) if self.reserve(top) => {
                self.next.set(top);
                self.live.set(self.live.get() + 1);
                start as *mut u8
            }
            _ => ptr::null_mut(),
        }
    }
}

unsafe impl GlobalAlloc for Arena {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        self.bump(layout)
    }

    unsafe fn dealloc(&self, ptr: *mut u8, layout: Layout) {
        let live = self.live.get() - 1;
        self.live.set(live);
        if live == 0 {
            self.next.set(self.base.get());
        } else if ptr as usize + layout.size() == self.next.get() {
            self.next.set(ptr as usize);
        }
    }

    unsafe fn realloc(&self, ptr: *mut u8, layout: Layout, new_size: usize) -> *mut u8 {
        let old = ptr as usize;
        if old + layout.size() == self.next.get() {
            // The most recent block: grow or shrink it in place.
            return match old.checked_add(new_size) {
                Some(top) if self.reserve(top) => {
                    self.next.set(top);
                    ptr
                }
                _ => ptr::null_mut(),
            };
        }
        // SAFETY: the caller guarantees `new_size`, rounded up to `layout.align()`, does not overflow `isize`.
        let new_layout = unsafe { Layout::from_size_align_unchecked(new_size, layout.align()) };
        let new_ptr = self.bump(new_layout);
        if !new_ptr.is_null() {
            // SAFETY: both blocks are live, distinct and at least `min(old, new)` bytes long.
            unsafe {
                ptr::copy_nonoverlapping(ptr, new_ptr, layout.size().min(new_size));
                self.dealloc(ptr, layout);
            }
        }
        new_ptr
    }
}

#[global_allocator]
static ARENA: Arena = Arena {
    base: Cell::new(0),
    next: Cell::new(0),
    end: Cell::new(0),
    live: Cell::new(0),
};

/// Panics trap instead of formatting a message, which keeps `core::fmt` out of the binary. Every expected failure
/// is a `Result` that reaches JavaScript as an `Error`; a trap means an exhausted 4 GiB memory or a bug.
#[panic_handler]
fn panic(_: &core::panic::PanicInfo) -> ! {
    wasm32::unreachable()
}
