# WASM codec and Leptonica dependencies

`dependencies.lock.json` records the dependency commits from
`naptha/tesseract.js-core@acffef2b66eb44a31df297e11d905f4b39001068`, the exact
download archive SHA256 values and the Git blob SHA1 values of its build recipes.
LibTIFF uses the GitHub mirror of the same pinned upstream GitLab commit.

From the repository root, using Node 22 or newer and the existing `adm-zip` package:

```powershell
node scripts/ocr-native/prepare-dependencies.cjs
node scripts/ocr-native/setup-toolchain.cjs --python '<путь к Python 3.8+ python.exe>' --build-root D:/tvs-ocr-native-build
node scripts/ocr-native/build-dependencies.cjs
```

The first toolchain setup requires an existing Python 3.8 or newer executable for
bootstrapping the SDK. Once `.native-ocr/toolchain.json` exists, setup can reuse
its configuration without the `--python` argument. The builder reads its local
portable SDK, CMake and Ninja paths. It changes the environment only for child
processes. Compiler and CMake configuration probes are part of compilation;
the scripts do not run OCR or functional tests.

Sources and downloaded archives are cached in `.native-ocr`. Build objects and
the install prefix come from `depsBuild` and `prefix` in `toolchain.json`. The
current build uses the task directory on drive D. The source preparer supports
`--offline` after the exact archives and recipe files have been cached. Existing
source directories need the matching `.tvs-pinned-source.json` marker; unknown
directories are never overwritten. The marker identifies the verified download,
not a continuing assertion that every local source file remains unmodified.

`build-dependencies.cjs --only leptonica` resumes an individual stage using the
already installed earlier dependencies. The full build is ordered: zlib, JPEG,
GIF, PNG, TIFF, WebP, Openlibm, Leptonica. `TVS_NATIVE_JOBS` controls concurrency
within a stage (default 2).

The tracked builder contains the Windows CMake recipes for GIF and Openlibm. Its
Openlibm source selection follows the pinned upstream `wasm32` conditions, uses
the SDK's Clang and LLVM archiver directly, and does not substitute another math
library. One declared local CMake patch renames an unused zlib shared target to
avoid the duplicate `libz.a` rule produced by the Emscripten platform; only the
original `zlibstatic` target is built. Codec C source code is unchanged.

The installed prefix contains `lib/*.a`, headers and Leptonica's imported CMake
target at `lib/cmake/leptonica`. `share/tvs-ocr-build` contains dependency pins,
licenses and copyright notices, upstream recipes, the local builder, the SDK
configuration and the actual dependency archive sizes and SHA256 values. The
build report states that OCR and functional tests were not run. Source pins and
build recipes allow rebuilding; bit identical output across arbitrary toolchain
or directory changes is not claimed.
