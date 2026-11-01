# Контракт первого клиента ДЭС объекта

Разработка на ветке `codex/des-object-client`. Рабочая база, пользовательские настройки и публикация не затрагиваются.

## Пакет

`format: "tvs-des-object-exchange"`, `version: 1`, `schemaVersion: 6`, `kind: "registration" | "snapshot" | "changes" | "receipt"`, `bundleId`, `source: {installationId,databaseToken}`, `targetDatabaseToken`, `scope: {org,site}`, `createdAt`, `payload`, `sha256`.

`sha256` — SHA-256 канонического содержимого без `sha256` и `signature`. Это целостность, не полномочия. Необязательная с точки зрения чистого декодера `signature: {algorithm:"Ed25519",publicKey,keyId,value}` проверяется принимающим Node-сервисом по закреплённому ключу установки. На исполнение неподписанный пакет не поступает. Приватные ключи остаются в собственной служебной SQLite.

- registration: запрос привязки установки. Центральный пользователь явно выбирает организацию и объект и подтверждает публичный ключ установки.
- snapshot: `payload: {sections,views,omissions}`. Первичная база объекта создаётся отдельно; внутренние audit/receipts/auth/source-файлы не копируются.
- changes: `payload: {changeEpoch,operations:[{operationId,section,id,before,beforeDigest,after,afterDigest}]}`. Тип ID сохраняется. Удаление — только явная операция с after:null, не отсутствие в пакете. Идентичность исходной операции выводится из установки и неизменяемого содержания. `changeEpoch` — непрозрачный ID локальной эпохи правки (до 128 символов ASCII: буквы, цифры, `.`, `_`, `:`, `-`). Сервис сохраняет его до подтверждённого ACK и передаёт при каждой повторной выгрузке; после подтверждения создаёт новую эпоху. Она входит в operationId и подписанное содержимое: повторная правка A→B после цикла A→B→A получает другой ID. Отсутствие эпохи допускается декодером только для первоначальных совместимых пакетов; новый сервис всегда задаёт её явно.
- receipt: `payload: {forBundleId,outcomes:[{originOperationId,status,centralOperation?,canonical?,message?}]}`. Локальный ACK не равен приёму центром. После импорта подписанной квитанции новая локальная правка не перезаписывается каноническим результатом старой операции.

## Чистое ядро DesObjectExchange

`project(database, scope)` → `{sections,views,omissions}`. Только ДЭС и доказанно связанные строки одного объекта. Общий многoобъектный утверждённый график — отдельное read-only представление с указанием источника, не поддельный изменённый снимок.

`snapshot(database, options)` и `changes(baseline,current,options)` → пакет. options: `{source:{installationId,databaseToken},targetDatabaseToken,scope,createdAt,changeEpoch?}`. Для `changes` сервис всегда передаёт сохранённую `changeEpoch`. Только безопасные JSON, известные разделы и ограниченный размер; без произвольных файловых путей.

`validateBundle(bundle)` → нормализованный пакет; подтверждает формат, лимиты, digest, но не полномочия.

`preview(database,bundle,options)` → `{canApply,sections,changes,conflicts,omissions}`. options: `{scope,targetDatabaseToken,readable?,writable?}`. Изменения с несовпадающей базой, недоказанной/чужой принадлежностью и конфликтом beforeDigest не применяются. Прочие объекты не заменяются. Итог дополнительно проходит штатный platform.prepareTransaction в Node-сервисе.

## Node service

`createDesObjectService({directory})` открывает только собственную служебную SQLite в явно переданном новом каталоге. Все обращения к бизнес-базе имеют явный `dataDir` и доверенный `principal` текущего вызывающего контекста.

Публичные методы сервиса: `status({dataDir?,principal?})`, `listScopes({dataDir,principal})`, `configure({scope,mode,connection?})`, `createRegistration()`, `register({dataDir,principal,bundle,scope})`, `exportSnapshot({dataDir,principal,installationId})`, `importSnapshot({bundle,confirmFingerprint})`, `exportChanges({dataDir,principal})`, `previewImport({dataDir,principal,bundle})`, `applyImport({dataDir,principal,bundle,reviewFingerprint,reason})`, `importReceipt({bundle})`.

В случае уточнения аргументов агент сообщает root до интеграции. Сервис не читает установленный settings.json и не открывает пользовательскую БД сам. Каталог по умолчанию не задаётся.

Доставка через HTTP и файл вызывает один декодер и одну таблицу исходных операций. Идемпотентность и квитанции основаны на существующем operation ledger. Подготовленный central envelope сохраняется до write; после неопределённого результата повторно проверяется тот же id+digest. Полномочия, подтверждения и закрытые периоды проверяются штатными валидаторами. При неподдерживаемом защищённом переходе — явное требование штатного доменного действия, а не обход проверки.

## Оболочка

Одна отдельная установка «ДЭС объекта» для любого объекта. appId/userData/default SQLite/outbox/обновления отделены от Диспетчера. Тот же index.html; профиль передаётся из доверенного main/preload, не через query/hash. Доступные экраны: ДЭС, ёмкости/ГСМ, ТО, ЗИП, ремонты, операторы/табели, отчёты и обмен. На центральной стороне — подраздел объектов ДЭС и экран приёма/выгрузки. Широкие серверные права нельзя принимать как подтверждение привязки к одному объекту.
