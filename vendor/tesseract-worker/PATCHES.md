# Локальная привязка Tesseract.js · версия 2

Источник JS worker: Tesseract.js **7.0.0**, Apache-2.0. Исходные авторы и лицензия сохранены. SHA256 оригиналов и сгенерированных файлов находятся в UPSTREAM.json. Генератор scripts/vendor-tesseract-worker.cjs проверяет исходные версии и hash; node_modules не изменяется.

## Привязка JS и нативное ядро — отдельные артефакты

- bindingPatchSetVersion: 2 в UPSTREAM.json относится к JS worker и его адаптеру.
- Нативное WASM-ядро располагается отдельно в vendor/tesseract-core. Его manifest.json содержит buildId, expectedRuntimeVersion, native patchSetSha256 и SHA256 каждой пары JS/WASM.
- Версия npm-пакета tesseract.js-core 7.0.0 фиксирует исходный интерфейс; она не является доказательством версии фактически загруженного C++/WASM.
- Нейросеть этой привязкой не дообучается. Профили языковых моделей и их происхождение описаны отдельно в assets/ocr/models-manifest.json.

## Выбор собственного ядра

Локальный get-core.cjs не вызывает stock Node getCore, который игнорирует corePath. Допускаются только реально собранные LSTM-варианты из manifest: scalar, SIMD и Relaxed SIMD. Scalar обязателен. Выбор учитывает wasm-feature-detect; отсутствие подходящего файла, несовпадение hash, ABI, native Version() или набора патчей останавливает загрузку. На стоковое ядро или CDN перехода нет.

Перед созданием модуля проверяются JS и WASM; factory получает проверенные WASM-байты. Проверяется контракт WebIDL, включая Init с четырьмя аргументами configFilename, SaveParameters/RestoreParameters, SetImageFile и GetJSONText. Загруженный модуль сообщает coreInfo в ответе load. Runtime сверяет его с собственной проверкой manifest, а затем повторно сверяет Version() результата распознавания.

Физические файлы worker и core находятся вне ASAR. Зависимости JS разрешаются относительно логического пакета внутри ASAR. В provenance результата записываются buildId, выбранный вариант, native patchSet hash, JS/WASM hashes и фактическая версия; абсолютные пути в nativeCore результата не включаются.

## Остальные изменения worker

- Ошибки загрузки WASM и Init завершают задание ошибкой; после неудачного Init не отправляется успех.
- Нативные статусы SetVariable и Recognize проверяются. Неподдерживаемый параметр не выдаётся за применённый.
- Временные параметры и режим разметки восстанавливаются при исключениях.
- TessBaseAPI и TessPDFRenderer освобождаются через TessModule.destroy(); временные файлы очищаются.
- Clear() вызывается перед новым изображением; ошибка декодирования не оставляет прежний документ.
- EXIF разбирается по структуре JPEG/TIFF; размеры проверяются до основной загрузки пикселей, преобразование возвращается отдельно.
- Сетевое получение языковых моделей отключено.

## Статическая проверка сборки

get-core.cjs экспортирует readManifest и verifyManifestAssets. Эти функции проверяют файлы и hashes без загрузки или инстанцирования WASM. Они используются runtime и предсборочной проверкой. Проверка синтаксиса, hashes и успешная компиляция не заменяют OCR-бенчмарк или функциональную приёмку.

Нативный source patch set включает C++/CMake/версию и JS WebIDL glue. Патч 0005-glue-overload-dispatch обязателен: он согласует допустимые перегрузки GetTextlines/GetComponentImages с реально экспортируемыми нативными сигнатурами; промежуточные arity завершаются TypeError. Это отдельный журнал от bindingPatchSetVersion.

Патч 0006-lstm-unavailable-legacy-api также обязателен. В сборке DISABLED_LEGACY_ENGINE пять отсутствующих legacy API — ClearAdaptiveClassifier, GetOsdText, DetectOS, OSResults.print_scores и AdaptToWordStr — завершаются явной ошибкой TVS_LSTM_LEGACY_UNAVAILABLE. Это сохраняет экспортируемый WebIDL ABI и строгую линковку без подмены результата пустым успехом. В полном legacy ядре прежние вызовы сохранены. Runtime OEM 1 не вызывает эти методы: распознавание запрашивает text и blocks, OSD отключён, допустимые PSM не включают режимы OSD. Данный вывод основан на чтении исходников, WASM и OCR при аудите не запускались.
