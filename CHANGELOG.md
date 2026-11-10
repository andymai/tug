# Changelog

## [0.41.0](https://github.com/andymai/tug/compare/v0.40.0...v0.41.0) (2026-11-10)


### Features

* **desktop:** let the Chrome Web Store's extension reach Tug ([#166](https://github.com/andymai/tug/issues/166)) ([99dac92](https://github.com/andymai/tug/commit/99dac9257ab3991c299318b78a8e0531215b4f46))

## [0.40.0](https://github.com/andymai/tug/compare/v0.39.0...v0.40.0) (2026-11-10)


### Features

* **extension:** send each release to the Chrome Web Store ([#164](https://github.com/andymai/tug/issues/164)) ([177a93c](https://github.com/andymai/tug/commit/177a93ce352635f644c6e8aedfdaed40059a1e45))

## [0.39.0](https://github.com/andymai/tug/compare/v0.38.0...v0.39.0) (2026-11-10)


### Features

* **extension:** attach the extension to each release, with install steps in the README ([#161](https://github.com/andymai/tug/issues/161)) ([2230013](https://github.com/andymai/tug/commit/2230013b4ee6561f0223b8409ddbcea7d0494287))

## [0.38.0](https://github.com/andymai/tug/compare/v0.37.3...v0.38.0) (2026-11-10)


### Features

* **desktop:** add .torrent files from the add dialog, tug and a file manager ([#158](https://github.com/andymai/tug/issues/158)) ([1ecd038](https://github.com/andymai/tug/commit/1ecd038cc8ffce1e52b82db6f8d31ca0ad94db2e))

## [0.37.3](https://github.com/andymai/tug/compare/v0.37.2...v0.37.3) (2026-11-10)


### Bug Fixes

* **core:** a resume, rename or remove while a download stops no longer races its settle ([#156](https://github.com/andymai/tug/issues/156)) ([cddbd98](https://github.com/andymai/tug/commit/cddbd984aa03862beacae7ad24723eb61707fd43))

## [0.37.2](https://github.com/andymai/tug/compare/v0.37.1...v0.37.2) (2026-11-09)


### Bug Fixes

* **desktop:** one helper keeps the newest panel answer, and one hook keeps newer edits ([#152](https://github.com/andymai/tug/issues/152)) ([47a5922](https://github.com/andymai/tug/commit/47a5922bc5b1163a3c5a42f22b36d059d2c39bae))

## [0.37.1](https://github.com/andymai/tug/compare/v0.37.0...v0.37.1) (2026-11-09)


### Bug Fixes

* **desktop:** commands that wait leave the window's thread, and checks keep it so ([#150](https://github.com/andymai/tug/issues/150)) ([625c3da](https://github.com/andymai/tug/commit/625c3dae8455203f812c3e4ad606f4c32b77f891))

## [0.37.0](https://github.com/andymai/tug/compare/v0.36.0...v0.37.0) (2026-11-09)


### Features

* **desktop:** choose a torrent's files, and see its peers, in the inspector ([#147](https://github.com/andymai/tug/issues/147)) ([9593a31](https://github.com/andymai/tug/commit/9593a314182ec81d192f82f0dfba3149485e2518))

## [0.36.0](https://github.com/andymai/tug/compare/v0.35.0...v0.36.0) (2026-11-09)


### Features

* **core:** rename a download before it starts or after it finishes ([#143](https://github.com/andymai/tug/issues/143)) ([ad531d7](https://github.com/andymai/tug/commit/ad531d70a9c2688632fd117cb757d7368ad95308))
* **core:** set the referrer, cookies and User-Agent a download sends ([#145](https://github.com/andymai/tug/issues/145)) ([9ee45d0](https://github.com/andymai/tug/commit/9ee45d01b74b920b613ba71f6a525f7f98484b13))

## [0.35.0](https://github.com/andymai/tug/compare/v0.34.0...v0.35.0) (2026-11-09)


### Features

* **core:** set a download's folder, connections, limit and start when adding, and change them later ([#141](https://github.com/andymai/tug/issues/141)) ([be2e522](https://github.com/andymai/tug/commit/be2e5221ad7d69c3c7cf66ece64b0b9db0e41192))

## [0.34.0](https://github.com/andymai/tug/compare/v0.33.0...v0.34.0) (2026-11-09)


### Features

* **desktop:** drag a column to the width you want, and Tug keeps it ([#140](https://github.com/andymai/tug/issues/140)) ([f23dd69](https://github.com/andymai/tug/commit/f23dd692f5b6b3c2ac3b794a7f7df8300bed0378))

## [0.33.0](https://github.com/andymai/tug/compare/v0.32.1...v0.33.0) (2026-11-09)


### Features

* **desktop:** drag waiting downloads into a new order, and move one with Alt and the arrows ([#138](https://github.com/andymai/tug/issues/138)) ([e8ce1bf](https://github.com/andymai/tug/commit/e8ce1bfa2aea0eb1889a19159cea126b4e092b78))

## [0.32.1](https://github.com/andymai/tug/compare/v0.32.0...v0.32.1) (2026-11-09)


### Bug Fixes

* **desktop:** selection commands show in the command bar and act on the row in view ([#136](https://github.com/andymai/tug/issues/136)) ([dd9c73d](https://github.com/andymai/tug/commit/dd9c73ddb19b7f1c87478daebf30fdc5eec1ee46))

## [0.32.0](https://github.com/andymai/tug/compare/v0.31.0...v0.32.0) (2026-11-09)


### Features

* **desktop:** select several downloads, act on them from a right-click menu, and remove them ([#134](https://github.com/andymai/tug/issues/134)) ([2ffdf20](https://github.com/andymai/tug/commit/2ffdf204b28dbd10e66f2548db8dae78fc8b6b16))


### Bug Fixes

* **core:** a removal that fails leaves the download paused, with its inspection ([#132](https://github.com/andymai/tug/issues/132)) ([1485eb0](https://github.com/andymai/tug/commit/1485eb0888e88e39e71044b99995c098900c50d4))
* **core:** hold the run lock while a download and its files go ([#133](https://github.com/andymai/tug/issues/133)) ([6987908](https://github.com/andymai/tug/commit/6987908d261eb1d674d2aebd372297decfedb590))

## [0.31.0](https://github.com/andymai/tug/compare/v0.30.0...v0.31.0) (2026-11-09)


### Features

* **core:** the live connections inspector: segments, connections, server and engine log ([#130](https://github.com/andymai/tug/issues/130)) ([0c385f1](https://github.com/andymai/tug/commit/0c385f17703a2c95f9b86e9cc42b19eb3f23172b))


### Bug Fixes

* **desktop:** check free space off the main thread, and keep the last limit across pages ([#129](https://github.com/andymai/tug/issues/129)) ([7b8891c](https://github.com/andymai/tug/commit/7b8891cbd751b8063757f2757efc28b511e74783))

## [0.30.0](https://github.com/andymai/tug/compare/v0.29.0...v0.30.0) (2026-11-09)


### Features

* **desktop:** a status bar with total speed, a speed graph, the limit in force and free space ([#127](https://github.com/andymai/tug/issues/127)) ([37836ae](https://github.com/andymai/tug/commit/37836aeee80fb46738e4476b48383006092a0514))

## [0.29.0](https://github.com/andymai/tug/compare/v0.28.0...v0.29.0) (2026-11-09)


### Features

* **desktop:** the download list as a dense table with sortable columns you pick ([#125](https://github.com/andymai/tug/issues/125)) ([c211048](https://github.com/andymai/tug/commit/c2110480730a3ac29d492196cc17b3dc1d9c75c7))

## [0.28.0](https://github.com/andymai/tug/compare/v0.27.0...v0.28.0) (2026-11-09)


### Features

* **desktop:** add magnet links in the window, with tug add, and as the system handler ([#122](https://github.com/andymai/tug/issues/122)) ([828da68](https://github.com/andymai/tug/commit/828da6800caa74dc4b288a4f4731076ec7203500))

## [0.27.0](https://github.com/andymai/tug/compare/v0.26.0...v0.27.0) (2026-11-09)


### Features

* **core:** download torrents and magnet links through mdm-torrent ([#120](https://github.com/andymai/tug/issues/120)) ([4542a2d](https://github.com/andymai/tug/commit/4542a2d02c2a2442354e1ceda19daf0224ec4f90))


### Bug Fixes

* **core:** keep a torrent that a Tug without torrents can't delete ([#121](https://github.com/andymai/tug/issues/121)) ([cdf4411](https://github.com/andymai/tug/commit/cdf4411e1e6b32cf4c4a75e454df3864b71a6f6b))

## [0.26.0](https://github.com/andymai/tug/compare/v0.25.1...v0.26.0) (2026-11-09)


### Features

* **desktop:** save a search as a view in the sidebar ([#116](https://github.com/andymai/tug/issues/116)) ([ef2f225](https://github.com/andymai/tug/commit/ef2f225b105530da03a43bfeafe0216d755eccb9))


### Bug Fixes

* **desktop:** a saved search counts as saved however its spaces are typed ([#119](https://github.com/andymai/tug/issues/119)) ([191bcc3](https://github.com/andymai/tug/commit/191bcc304c29826900f3fb5486b7873d2c68be6a))

## [0.25.1](https://github.com/andymai/tug/compare/v0.25.0...v0.25.1) (2026-11-09)


### Bug Fixes

* **desktop:** a jump clears a search whose answer is still on its way ([#114](https://github.com/andymai/tug/issues/114)) ([3216aae](https://github.com/andymai/tug/commit/3216aae7ccfa5e6147bdf60c922b54825e80683e))

## [0.25.0](https://github.com/andymai/tug/compare/v0.24.0...v0.25.0) (2026-11-09)


### Features

* **core:** sort downloads into types by their file name ([#112](https://github.com/andymai/tug/issues/112)) ([343d207](https://github.com/andymai/tug/commit/343d2071cf3b4e27f1f3984d83f68fd2204df461))


### Bug Fixes

* **desktop:** keep a search current with new names and downloads, and clear it for a jump ([#113](https://github.com/andymai/tug/issues/113)) ([24a3ed6](https://github.com/andymai/tug/commit/24a3ed662b8d89812556bebd524b3fe7ed807817))

## [0.24.0](https://github.com/andymai/tug/compare/v0.23.0...v0.24.0) (2026-11-09)


### Features

* **core:** search downloads by the words in their name or link ([#109](https://github.com/andymai/tug/issues/109)) ([d0a3b28](https://github.com/andymai/tug/commit/d0a3b28382b77d340f097b8936ade8ce46e95f8b))


### Bug Fixes

* **core:** keep a pause or resume made while the hours stop a download ([#108](https://github.com/andymai/tug/issues/108)) ([346896b](https://github.com/andymai/tug/commit/346896b095f1ad07197e9962a2416ee6c8c965d5))
* **core:** pause all and resume all reach a download that the hours stop ([#111](https://github.com/andymai/tug/issues/111)) ([ed89e45](https://github.com/andymai/tug/commit/ed89e451cabae7031ab244e3f6956823967e9a42))

## [0.23.0](https://github.com/andymai/tug/compare/v0.22.1...v0.23.0) (2026-11-09)


### Features

* **core:** a slower speed limit for set hours on chosen days ([#106](https://github.com/andymai/tug/issues/106)) ([6bac6ab](https://github.com/andymai/tug/commit/6bac6abe5f9ce4913176ff52c8e31ba8665ce69a))
* **core:** download only at set hours on chosen days ([#105](https://github.com/andymai/tug/issues/105)) ([8b22a41](https://github.com/andymai/tug/commit/8b22a41da9004ff763a5e0ff4115eed809f9db1d))

## [0.22.1](https://github.com/andymai/tug/compare/v0.22.0...v0.22.1) (2026-11-09)


### Bug Fixes

* **core:** the progress stream reports what changed outside a tick, and the mock keeps the queue ([#102](https://github.com/andymai/tug/issues/102)) ([c215ee5](https://github.com/andymai/tug/commit/c215ee5de467d27c4f88e7e6da63e93148d84db6))

## [0.22.0](https://github.com/andymai/tug/compare/v0.21.3...v0.22.0) (2026-11-09)


### Features

* **core:** run three downloads at once by default and queue the rest in order ([#100](https://github.com/andymai/tug/issues/100)) ([247a205](https://github.com/andymai/tug/commit/247a2050e39cce23b9abb6e5e555bef9ef16065a))
* **desktop:** draw Tug's own title bar instead of the window manager's ([#97](https://github.com/andymai/tug/issues/97)) ([5171ea1](https://github.com/andymai/tug/commit/5171ea1a25d6aa85330ee13880825094465bf987))

## [0.21.3](https://github.com/andymai/tug/compare/v0.21.2...v0.21.3) (2026-11-09)


### Bug Fixes

* **desktop:** draw the tray icon with the same 1px lines as Breeze ([#98](https://github.com/andymai/tug/issues/98)) ([ad1fbcd](https://github.com/andymai/tug/commit/ad1fbcdd39b6d6f01769554bc2029f299415a29b))

## [0.21.2](https://github.com/andymai/tug/compare/v0.21.1...v0.21.2) (2026-11-09)


### Bug Fixes

* **desktop:** keep the AppImage launcher's libraries away from host programs ([#95](https://github.com/andymai/tug/issues/95)) ([d725947](https://github.com/andymai/tug/commit/d725947b7128b1932de3485cd5ad9d3c0964fdc4))

## [0.21.1](https://github.com/andymai/tug/compare/v0.21.0...v0.21.1) (2026-11-09)


### Bug Fixes

* **desktop:** cancel and resume decide under one lock, and notices never wait in line ([#93](https://github.com/andymai/tug/issues/93)) ([94473ff](https://github.com/andymai/tug/commit/94473ff5d1b98b8e2e4ae5afa6349da30b939e9c))
* **desktop:** notify for every settled download, in the Flatpak too ([#91](https://github.com/andymai/tug/issues/91)) ([8c5fba2](https://github.com/andymai/tug/commit/8c5fba2895fa2f047e312084b3b9567aedaae170))

## [0.21.0](https://github.com/andymai/tug/compare/v0.20.0...v0.21.0) (2026-11-09)


### Features

* **desktop:** show download progress on the Plasma task manager ([#89](https://github.com/andymai/tug/issues/89)) ([ff16959](https://github.com/andymai/tug/commit/ff16959199a381df279728860a08d8b12d4a3543))


### Bug Fixes

* **desktop:** start captures paused in one write, and stop asking about started ones ([#90](https://github.com/andymai/tug/issues/90)) ([d73526e](https://github.com/andymai/tug/commit/d73526e230b7d3a91936d1334dbe7883f0abdad0))

## [0.20.0](https://github.com/andymai/tug/compare/v0.19.1...v0.20.0) (2026-11-09)


### Features

* **desktop:** notify when a download finishes or fails, with Open and Show in folder ([#87](https://github.com/andymai/tug/issues/87)) ([a6c58cd](https://github.com/andymai/tug/commit/a6c58cdefc615c1c1d13efb43888758f99d0a727))
* **desktop:** the capture sheet: ask before each browser download, or start it silently ([#85](https://github.com/andymai/tug/issues/85)) ([1235143](https://github.com/andymai/tug/commit/123514319989e7b61b83df29a66739c06ec57f33))


### Bug Fixes

* **extension:** one form-memory update at a time, so a prune never deletes a fresh marker ([#86](https://github.com/andymai/tug/issues/86)) ([e8cc4d3](https://github.com/andymai/tug/commit/e8cc4d3bf9e8ed99cd33ce3a6629b1e4f53c1572))

## [0.19.1](https://github.com/andymai/tug/compare/v0.19.0...v0.19.1) (2026-11-09)


### Bug Fixes

* match hosts with a trailing dot, and remember forms across worker restarts ([#83](https://github.com/andymai/tug/issues/83)) ([7ca0962](https://github.com/andymai/tug/commit/7ca09628b6ca8605f7fe0f6585915223e3088200))

## [0.19.0](https://github.com/andymai/tug/compare/v0.18.0...v0.19.0) (2026-11-09)


### Features

* **desktop:** sites that Tug leaves to the browser ([#80](https://github.com/andymai/tug/issues/80)) ([e97cda4](https://github.com/andymai/tug/commit/e97cda4345fa34d43e56100779642357abdb056e))


### Bug Fixes

* **extension:** referrer policy, strict replies, forms and containers stay right; untrack the build ([#81](https://github.com/andymai/tug/issues/81)) ([bf471e1](https://github.com/andymai/tug/commit/bf471e1b10d29b986e8083815a0283716157f7f7))

## [0.18.0](https://github.com/andymai/tug/compare/v0.17.0...v0.18.0) (2026-11-09)


### Features

* **extension:** hand browser downloads to Tug from Chromium and Firefox ([#77](https://github.com/andymai/tug/issues/77)) ([0a0ca5a](https://github.com/andymai/tug/commit/0a0ca5a569cc463604f406170accd30ea6993c0f))


### Bug Fixes

* **core:** forget a download's cookies in the same write that marks it done ([#78](https://github.com/andymai/tug/issues/78)) ([a0aefab](https://github.com/andymai/tug/commit/a0aefabf176993f391c3b439ca4be743eb5cccd3))

## [0.17.0](https://github.com/andymai/tug/compare/v0.16.1...v0.17.0) (2026-11-09)


### Features

* **core:** carry a link's referrer, cookies and User-Agent from the browser to the engine ([#75](https://github.com/andymai/tug/issues/75)) ([f03d8b2](https://github.com/andymai/tug/commit/f03d8b2c212d30a89361663a1e3d06fd8e4ec5ed))

## [0.16.1](https://github.com/andymai/tug/compare/v0.16.0...v0.16.1) (2026-11-09)


### Bug Fixes

* **desktop:** give each browser registration its own staged file ([#73](https://github.com/andymai/tug/issues/73)) ([e836d55](https://github.com/andymai/tug/commit/e836d551ef4d1b493ad3f582524ea3b412cda899))

## [0.16.0](https://github.com/andymai/tug/compare/v0.15.0...v0.16.0) (2026-11-09)


### Features

* **desktop:** register the browser host, with a flatpak-spawn bridge for Flatpak browsers ([#70](https://github.com/andymai/tug/issues/70)) ([b5b9fc5](https://github.com/andymai/tug/commit/b5b9fc5f8602b9d2d8df2679d70094678fdafa66))

## [0.15.0](https://github.com/andymai/tug/compare/v0.14.1...v0.15.0) (2026-11-09)


### Features

* **host:** tug-host, the native messaging host, over the IPC socket ([#66](https://github.com/andymai/tug/issues/66)) ([9f74398](https://github.com/andymai/tug/commit/9f74398f05b99ef3780a98d8d13c8c052d9f7751))


### Bug Fixes

* **host:** bound every reply, reap launched Tugs, and time out the liveness probe ([#67](https://github.com/andymai/tug/issues/67)) ([ebca748](https://github.com/andymai/tug/commit/ebca748ed82eade4c969bee441154f2662ec2cea))
* **ipc:** keep a busy server's socket, and test that tug-host reaps what it starts ([#68](https://github.com/andymai/tug/issues/68)) ([e416cb1](https://github.com/andymai/tug/commit/e416cb14b69b4cbb33da25391a16f5500ddccde9))

## [0.14.1](https://github.com/andymai/tug/compare/v0.14.0...v0.14.1) (2026-11-09)


### Bug Fixes

* **core:** bound each CLI request, and respect a socket from an older Tug ([#64](https://github.com/andymai/tug/issues/64)) ([3799a64](https://github.com/andymai/tug/commit/3799a642976f25aa5f6b5295390f81603d950e54))
* **core:** claim the socket with a lock, bound CLI waits, limit each request ([#63](https://github.com/andymai/tug/issues/63)) ([7cd98a3](https://github.com/andymai/tug/commit/7cd98a390a00fb0a8e9e83fa823bc2c4eaeae16c))

## [0.14.0](https://github.com/andymai/tug/compare/v0.13.2...v0.14.0) (2026-11-09)


### Features

* **core:** one Tug per session over a token-protected socket, with tug add and tug list ([#61](https://github.com/andymai/tug/issues/61)) ([1bab8bd](https://github.com/andymai/tug/commit/1bab8bdf1edaa50748af318fa6c3941b6d676a70))

## [0.13.2](https://github.com/andymai/tug/compare/v0.13.1...v0.13.2) (2026-11-08)


### Bug Fixes

* **desktop:** test the tray's check gate, and say why notices can't be followed ([#56](https://github.com/andymai/tug/issues/56)) ([faff68e](https://github.com/andymai/tug/commit/faff68e15f7db5dccc29e813c98fdedf22fb2ce3))

## [0.13.1](https://github.com/andymai/tug/compare/v0.13.0...v0.13.1) (2026-11-08)


### Bug Fixes

* **desktop:** report tray failures, read the library once a second, fix a check race ([#53](https://github.com/andymai/tug/issues/53)) ([961ad22](https://github.com/andymai/tug/commit/961ad229c806888893a6a2e12adfd6553ff69b21))

## [0.13.0](https://github.com/andymai/tug/compare/v0.12.1...v0.13.0) (2026-11-08)


### Features

* **desktop:** a progress ring, a tooltip, and Pause all and Resume all in the tray ([#51](https://github.com/andymai/tug/issues/51)) ([cb40d59](https://github.com/andymai/tug/commit/cb40d599a2f2444d13f52cbd7af23ca863ef6078))

## [0.12.1](https://github.com/andymai/tug/compare/v0.12.0...v0.12.1) (2026-11-08)


### Bug Fixes

* **desktop:** show the window and stop hiding it when the tray host leaves ([#49](https://github.com/andymai/tug/issues/49)) ([e3dfa88](https://github.com/andymai/tug/commit/e3dfa88ce8d283d31b198c88be6c5d4ab90faf5f))

## [0.12.0](https://github.com/andymai/tug/compare/v0.11.1...v0.12.0) (2026-11-08)


### Features

* **desktop:** a tray item with the symbolic icon, a menu, and close to tray ([#47](https://github.com/andymai/tug/issues/47)) ([15425a4](https://github.com/andymai/tug/commit/15425a45422fbc9456dd43514095a9a97473f4e4))

## [0.11.1](https://github.com/andymai/tug/compare/v0.11.0...v0.11.1) (2026-11-08)


### Bug Fixes

* **desktop:** keep a newer color scheme over the first read, and clear mock listeners ([#45](https://github.com/andymai/tug/issues/45)) ([9681d30](https://github.com/andymai/tug/commit/9681d302febf0c4fa269eb7dadad88468def1d05))

## [0.11.0](https://github.com/andymai/tug/compare/v0.10.2...v0.11.0) (2026-11-08)


### Features

* **desktop:** light and dark follow the system, with a theme setting ([#43](https://github.com/andymai/tug/issues/43)) ([8b2bb0e](https://github.com/andymai/tug/commit/8b2bb0e012068a75a2dbfea578496dfb3f33ec9d))

## [0.10.2](https://github.com/andymai/tug/compare/v0.10.1...v0.10.2) (2026-11-08)


### Bug Fixes

* **desktop:** clear the folder chooser's failure when a retry succeeds ([#42](https://github.com/andymai/tug/issues/42)) ([b386ac0](https://github.com/andymai/tug/commit/b386ac0b113658ef8c5a295f306de70fa9d939b6))
* **desktop:** save settings as patches over the confirmed settings ([#40](https://github.com/andymai/tug/issues/40)) ([e49639a](https://github.com/andymai/tug/commit/e49639aeef736dfcd336ef190c393ac072b468a5))

## [0.10.1](https://github.com/andymai/tug/compare/v0.10.0...v0.10.1) (2026-11-08)


### Bug Fixes

* **desktop:** keep quick settings changes, and go to a download from settings ([#38](https://github.com/andymai/tug/issues/38)) ([c85db39](https://github.com/andymai/tug/commit/c85db39a305393326ab5f7e2a59010e00fa01d35))

## [0.10.0](https://github.com/andymai/tug/compare/v0.9.1...v0.10.0) (2026-11-08)


### Features

* **desktop:** the settings page with the portal folder chooser ([#36](https://github.com/andymai/tug/issues/36)) ([77118be](https://github.com/andymai/tug/commit/77118be55c1d634c38c69ab12b6dde542a43b3de))

## [0.9.1](https://github.com/andymai/tug/compare/v0.9.0...v0.9.1) (2026-11-08)


### Bug Fixes

* **desktop:** run a command bar option on a primary click only ([#34](https://github.com/andymai/tug/issues/34)) ([f43e420](https://github.com/andymai/tug/commit/f43e420c2f452021f2d30d2a9dc694c9ebdf9657))

## [0.9.0](https://github.com/andymai/tug/compare/v0.8.1...v0.9.0) (2026-11-08)


### Features

* **desktop:** the command bar (Ctrl+K) and the keyboard map ([#32](https://github.com/andymai/tug/issues/32)) ([845671d](https://github.com/andymai/tug/commit/845671d99dfe7afd3022afd09fda8dc1c69e40c0))

## [0.8.1](https://github.com/andymai/tug/compare/v0.8.0...v0.8.1) (2026-11-08)


### Bug Fixes

* **core:** report settled downloads when their history fails to save ([#30](https://github.com/andymai/tug/issues/30)) ([dc18288](https://github.com/andymai/tug/commit/dc18288d9e0b410ef34ec5228ba71c7465d2be8e))

## [0.8.0](https://github.com/andymai/tug/compare/v0.7.1...v0.8.0) (2026-11-08)


### Features

* **desktop:** the event log in the detail panel ([#28](https://github.com/andymai/tug/issues/28)) ([2cda185](https://github.com/andymai/tug/commit/2cda1851311ec253cfcc419746d4942f3972dbf7))

## [0.7.1](https://github.com/andymai/tug/compare/v0.7.0...v0.7.1) (2026-11-08)


### Bug Fixes

* **desktop:** open paths byte for byte, and give focus back to the row ([#26](https://github.com/andymai/tug/issues/26)) ([054ea49](https://github.com/andymai/tug/commit/054ea490bf4a1d49000764f44872737d238eef3f))

## [0.7.0](https://github.com/andymai/tug/compare/v0.6.1...v0.7.0) (2026-11-08)


### Features

* **desktop:** the detail panel with live facts and actions ([#23](https://github.com/andymai/tug/issues/23)) ([c445621](https://github.com/andymai/tug/commit/c445621aab1cc2994d33230bd3341cfa38a1dc8e))

## [0.6.1](https://github.com/andymai/tug/compare/v0.6.0...v0.6.1) (2026-11-08)


### Bug Fixes

* **desktop:** keep typed links exact, name bad escapes, and scope adds to their dialog ([#21](https://github.com/andymai/tug/issues/21)) ([426a422](https://github.com/andymai/tug/commit/426a422cfc1306bed4147f2fb7ae40413213a42d))

## [0.6.0](https://github.com/andymai/tug/compare/v0.5.2...v0.6.0) (2026-11-08)


### Features

* **desktop:** add links by dialog, paste or drop, with checks and duplicates ([#19](https://github.com/andymai/tug/issues/19)) ([8cbe680](https://github.com/andymai/tug/commit/8cbe6805fe8e780f74ecfb14829a7ec0ece37ed3))

## [0.5.2](https://github.com/andymai/tug/compare/v0.5.1...v0.5.2) (2026-11-08)


### Bug Fixes

* **desktop:** keep a load error and a notice apart ([#16](https://github.com/andymai/tug/issues/16)) ([0fdff9b](https://github.com/andymai/tug/commit/0fdff9bfcb108d22bcb391ad72411c60747520ff))

## [0.5.1](https://github.com/andymai/tug/compare/v0.5.0...v0.5.1) (2026-11-08)


### Bug Fixes

* **desktop:** load the list when progress can't be followed, and show batch errors ([#14](https://github.com/andymai/tug/issues/14)) ([8d2da12](https://github.com/andymai/tug/commit/8d2da12ca4ac9b73051f6e278118c129e2263a53))

## [0.5.0](https://github.com/andymai/tug/compare/v0.4.0...v0.5.0) (2026-11-08)


### Features

* **desktop:** the main window with views, download rows and empty states ([#12](https://github.com/andymai/tug/issues/12)) ([b1d0069](https://github.com/andymai/tug/commit/b1d006997e0004bd5b7d966d007950635e2275b2))

## [0.4.0](https://github.com/andymai/tug/compare/v0.3.0...v0.4.0) (2026-11-08)


### Features

* **desktop:** bridge the library to the UI with typed commands and a mock ([#10](https://github.com/andymai/tug/issues/10)) ([df5d700](https://github.com/andymai/tug/commit/df5d700892c53106299651cbe95d776b4eb11616))

## [0.3.0](https://github.com/andymai/tug/compare/v0.2.0...v0.3.0) (2026-11-08)


### Features

* **core:** add settings for the download folder, connections and a speed limit ([#6](https://github.com/andymai/tug/issues/6)) ([9bbb82a](https://github.com/andymai/tug/commit/9bbb82a55141f020a3d71338d603ec24f2df3d7d))

## [0.2.0](https://github.com/andymai/tug/compare/v0.1.0...v0.2.0) (2026-11-08)


### Features

* **core:** stream batched progress for every download ([#4](https://github.com/andymai/tug/issues/4)) ([3477def](https://github.com/andymai/tug/commit/3477deff3cdeac318ec797f30d3535f2d713cf68))

## [0.1.0](https://github.com/andymai/tug/compare/v0.0.1...v0.1.0) (2026-11-08)


### Features

* **core:** manage downloads as a persistent library ([#3](https://github.com/andymai/tug/issues/3)) ([caf7a08](https://github.com/andymai/tug/commit/caf7a0891e65924fa2b1e94c6bfc3392398eb3cb))
* **core:** store downloads and settings in SQLite ([#1](https://github.com/andymai/tug/issues/1)) ([9ad0e67](https://github.com/andymai/tug/commit/9ad0e679c5a86dd200802513ed17d1fdee8f9e7e))
