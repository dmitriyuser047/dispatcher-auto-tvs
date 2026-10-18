# TVS native OCR core build

This directory compiles the real C++ Tesseract core into WebAssembly. It does not run OCR, tests, or benchmarks, and does not train or change neural model weights.

## Pins and changes

- JavaScript/WebIDL core: `naptha/tesseract.js-core@acffef2b66eb44a31df297e11d905f4b39001068` (upstream package 7.0.0).
- Native engine: `Balearica/tesseract@2a9c1c49c360462733c386d2a44fcd22c4e21411` (upstream 5.3.0).
- Emscripten 4.0.15. The portable toolchain paths and exact release identity are in `toolchain.json`.
- `0001`: propagate the caller's DAWG switches into the LSTM recognizer's separate parameter set.
- `0002`: clear the previous input image when decoding a replacement input fails; handle alpha-removal failure.
- `0003`: use the configured Emscripten compiler path, portable post-JS/export/font arguments, fail linking on unresolved native symbols, and compile the real SSE dot-product fallback required by the relaxed-SIMD dispatcher.
- `0004`: distinguish the native build as `5.3.0-tvs1`. Numeric version macros remain 5, 3, and 0.
- `0005`: keep only the real `GetTextlines` (2/5 arguments) and `GetComponentImages` (4/7 arguments) native overloads. Unsupported argument counts raise `TypeError` instead of calling nonexistent native symbols.
- `0006`: in LSTM-only builds, five unsupported legacy/OSD bindings explicitly raise `TVS_LSTM_LEGACY_UNAVAILABLE` JavaScript errors. The real calls remain available under the legacy-enabled compile branch. Strict native linking stays enabled.

The custom APIs in checked-in `javascript/glue.js`, `javascript/src/glue.cpp`, and `javascript/src/wrapper.cpp` are retained; only the stale JS overload dispatchers receive patch 0005. Do not regenerate these files from the older IDL: that IDL omits custom APIs used by the application's worker.

## Build inputs

`prefix/include` must contain the codec headers. `prefix/lib` must contain Emscripten/wasm32 static archives:

```
libgif.a libjpeg.a libopenlibm.a libpng.a libtiff.a libtiffxx.a
libwebp.a libwebpdecoder.a libwebpdemux.a libz.a
```

Leptonica must also be installed with `include/leptonica`, its static library, and `lib/cmake/leptonica/LeptonicaConfig.cmake` plus imported targets. `libopenlibm.a` must come from the pinned openlibm sources, not the host C runtime. Dependency source identities and build recipes are recorded separately by the dependency build.

## Commands

On a clean source directory, with Node.js, Git, and Windows `tar` available:

```powershell
node scripts/ocr-native/prepare-core-source.cjs
```

Prepare the pinned dependency prefix with the separate dependency builder. Then:

```powershell
node scripts/ocr-native/build-core.cjs --jobs 4
```

The defaults are taken from `toolchain.json`. Current build and dependency prefix paths use drive D to preserve space on C. Override them explicitly with `--prefix`, `--build-dir`, and `--output` when needed. The script configures independent Ninja build directories concurrently, then compiles and links each variant sequentially with four jobs by default:

| Variant | Native flags | Output pair |
| --- | --- | --- |
| scalar LSTM | SSE4.1 OFF, AVX OFF, AVX2 OFF | `tesseract-core-lstm.js` / `.wasm` |
| SIMD LSTM | SSE4.1 ON, AVX OFF, AVX2 OFF; architecture sources use `-msimd128` | `tesseract-core-simd-lstm.js` / `.wasm` |
| relaxed SIMD LSTM | SSE4.1 ON, AVX ON, AVX2 ON; architecture sources use `-msimd128 -mrelaxed-simd` | `tesseract-core-relaxedsimd-lstm.js` / `.wasm` |

The AVX/SSE flags select the port's WebAssembly intrinsics implementation. They do not produce x86 binaries. The application's released artifact is the default three LSTM variants, external `.wasm` pairs, and OEM 1. The optional `--all` and `--single-file` are additional source-build targets; a six-variant legacy distribution is not accepted by the application's LSTM-only runtime manifest validator.

## Output and evidence

Output stays outside the application until reviewed. It includes native artifact SHA256 values, source commits/archive SHA256, patch files and SHA256, custom glue SHA256, the toolchain pin, generated version-header and staged-font SHA checks, and licenses. `manifest.json` is the runtime adapter contract; `build-manifest.json` is the detailed compiler/build record. The static inspector matches the real C++ definitions to the emitted JS assignments and binary WASM export names, without evaluating JavaScript or instantiating WASM. These build and static checks do not constitute an OCR accuracy or runtime compatibility result.

## Windows portability

The original Bash/autotools build scripts cannot run unchanged in PowerShell. The native build uses portable CMake/Ninja/Emscripten and explicit toolchain paths. Emcc export lists use CSV syntax to avoid POSIX single-quote assumptions in `cmd.exe`. The unchanged PDF font is staged into the ASCII build directory because `file_packager` emits `.incbin` paths using the host text encoding. Its embedded filename remains `pdf.ttf`.

Keep `EM_CACHE` on the same Windows drive as the SDK: Emscripten 4.0.15 system-library builds use `os.path.relpath` between those locations. The default cache remains inside the SDK on C; native object, dependency prefix, and output folders can stay on D. CMake receives a single prefix path because the pinned engine appends `/lib/lib*.a` to it. Each variant uses a separate build folder to prevent architecture flags carrying into another output.

LSTM-only artifacts explicitly reject `ClearAdaptiveClassifier`, `GetOsdText`, `DetectOS`, `AdaptToWordStr`, and `OSResults.print_scores`. These legacy/OSD operations are not used by the application's OEM 1 text/block workflow. No unresolved native stub is used to imitate them.
