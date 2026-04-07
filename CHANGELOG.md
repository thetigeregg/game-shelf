# Changelog

## v0.0.2 - 2026-02-19

- 87ca15e Add automatic release bump workflow
- 86ea3b6 Extend manual lookup aliasing
- 17958d5 Extend manual lookup aliases
- d346bbe Investigate secrets in git history
- fd20321 Check git history for leaked secrets
- 2d99735 Verify git history and clean secrets
- 31208b9 Scan history for env secrets
- bdabbb1 Audit frontend-to-backend gaps
- 7be6773 Audit full stack for cleanup
- 92d7c1b Audit frontend-backend gaps
- 6268bd8 Audit full stack for gaps
- bee6443 Fix e-Reader platform alias display
- c44b635 Fix e-Reader alias handling
- efec0ed Update safe bottom handling
- f809fb3 Fix forest contrast in dark mode
- 6af54ca Adjust buffers and forest contrast
- cea138b Fix accordion border color
- 73c1394 Adjust virtual buffer handling
- 364ac4a Ensure fab search opens keyboard
- f598ad3 Add bottom border to advanced-filers
- 0fc8970 Add border to advanced filters
- aff80d1 Add filter accordion header border
- d08cf69 Tie filters to stable platform names
- 43bba38 Fix platform alias handling
- 5162e53 Fix platform aliasing display
- 1403867 Stop closing search overlay on add
- 3f0e661 Prevent platform aliasing in search
- 249f091 Add icons and refine search select
- 0e0fb9d Add icons and expanders to game info
- 2ab02a4 Add icons to game detail items
- 679962f Make detail texts toggleable
- 442aa84 Restore fab layout on Tags Views
- 86e5cdc Revert tag view fab move
- 3c6b386 Restore fab buttons on tags views
- 2738080 Update game detail layout
- 86eb9e3 Update IonFab behavior
- 94a5b1d Adjust game detail header and fab
- a1bdafe Adjust detail page header and fab
- 769c271 Adjust detail cover under header
- 83d96b8 Add auto offsets for IonContent
- 35d0b72 Add scripts to edge Docker build
- ec597f1 Update ESLint configuration to ignore additional directories and remove unnecessary comment in zone-flags
- d643592 Update lint script to use ESLint directly
- c0aadc1 Update UI smoke tests assertions
- 05553a0 Replace ESLint configuration with a new module-based setup
- 76b188e Add ESLint dependencies for improved code quality
- e307d82 Revert "Update header and fab behaviors"
- 9691bae Add lint-staged and configure pre-commit hook for linting and formatting
- 65194d2 Add husky as a development dependency
- 30e7f7a Format files with Prettier
- 41fe0b1 Update .prettierignore
- 6b07fa9 Format .prettierrc for better readability
- 554ac86 Add Prettier config
- b3bd413 Add Prettier as a development dependency
- 7f48d65 Update header and fab behaviors
- 827fa1b Update header search behavior
- ea6bc03 Update list header search flow
- 60c273f Update fab actions to close list
- 7c65257 Adjust header search focus handling
- 933cb23 Remove collapse behavior from header
- 1a6d33b Add header searchbar for list page
- 9116944 Add fab scroll button and flag
- c9360ff Fix quick actions fab behavior
- dce07aa Add forest color and fab scroll top
- 0a48e6c Add forest colored fab buttons
- e200d13 Add fixed IonFab quick actions
- 4793b55 Fix external URL handling by updating anchor element attributes
- 05b4ba1 Revert "Add @capacitor/browser dependency version 8.0.1"
- a0c12ea Revert "Use Capacitor Browser to open external URLs in GameListComponent"
- cb77670 Revert "Improve external URL handling"
- 8138383 Fix platform alias canonical mapping
- bf9b09e Improve external URL handling
- 8fed8f4 Use Capacitor Browser to open external URLs in GameListComponent
- 38f2045 Add @capacitor/browser dependency version 8.0.1
- e1ff14a Revert "Add capgo inappbrowser dependency"
- 1f59198 Update @typescript-eslint packages to version 8.56.0 and tar to version 7.5.9
- b8aa850 Add capgo inappbrowser dependency
- f950264 Skip filtering when no constraints
- 89f00c6 Cache sorted game lists
- 65373cb Allow open IonAccordion groups
- 359566a Move add button into header
- e2953aa Add Fix HLTB match option
- 3bdf97d Add Fix HLTB match menu item
- 476a1aa Rename Fix IGDB match menu item
- 91f105d Fix HLTB match handling
- 2236ae7 Encode special chars for HLTB search
- 13a7449 Improve HLTB bulk updates
- e422525 Remove HLTB search cache entry
- a5ce03c Exclude logging files from coverage
- b225811 Increase debug log coverage
- 849e45d Merge pull request #1 from thetigeregg/new-rel
- 2d6b8e0 Fix metadata validator bulk HLTB
- 22da8c4 Handle malformed identity keys
- f87fa4c Purge gamesdb cache for PS5 and new
- ae2379e Use effective HLTB hours filter
- 802d80a Add igdb:id search switch
- 3ab1f7f Handle umlaut search normalization
- bd339f7 Fix UI lockups and normalization
- fe073f4 Add platform aliases for legacy
- 5593c0c Fix game metadata modal focus
- 1957614 Update UI placement and warnings
- ba3c765 Increase SCSS style budget limits
- 7fead78 Add safe-area inset padding for game
- 4c95901 Revert "Adjust list page layout"
- 7618a50 Bypass blob cache in standalone
- ee2edc3 Adjust list page layout
- 2ea312e Move views FAB to header button
- c0cf3a6 Compress oversized client images
- 33806a1 Compress oversized custom images
- de6b37c Focus wishlist search modal
- 98f8b55 Ensure focus on searchbar modal
- 62660ec Add IGDB cover option to modal
- 9fd7cc4 Remove share logic add box art upl
- 47afc66 Add box art upload modal
- 85090a8 Add custom box art upload
- 6899c6b Remove capacitor share dependency
- 0bedd50 Refine multi-select UX and loading
- 14de27f Rework multi-select activation flow
- c385d85 Adjust multi-select activation flow
- 6b83640 Redesign multi-select activation
- 57d5e61 Update multi-select activation flow
- 75df01c Fix multi select long press
- 7d5930e Fix settings cache controls
- ce3c972 Add purge local image cache button
- 1a144db Add editable game metadata modal
- 98a1b6f Add editable game metadata UI
- 2c48aa7 Add custom game metadata editor
- 561ad7c Add customizable game metadata
- 97bd365 Add ESLint Capacitor restriction
- cd853b0 Fix settings share export flow
- 639e9cb Add Capacitor share dependency
- f6d1385 Use URLs for thumbnail cache
- 6100f0f Stop creating extra export text file
- c5d170d Add diagnostics for image cache
- 2caf47f Fix image cache flicker
- 44bfc71 Debug search image export issues
- ffc898c Fix semicolon search and image load
- 02a7a57 Sanitize semicolons in searches
- d4a7d85 Display platforms summary in modal
- 435a57e Update platform display logic
- f340654 Fix resolve modal platform text
- ef59f89 Update resolver platform summary
- f735788 Fix MGC import and cache issues
- a195f3d Update iOS status bar style
- 74247ac Add NGSW data group caching
- 25be4f4 Update favicon to icon_new
- 2405300 Refresh favicon and PWA icons
- baa8594 Add ionbadge to search icon
- 1f2d9af Adjust list page header layout
- ae3e925 Simplify list count summary
- 94b84f4 Adjust explore search modal styling
- 860f5d3 Adjust list modal layout
- 6342b7d Reduce modal height
- 447aa2d Adjust list search modal layout
- 7dfc4e3 Adjust header count placement
- 6bd4cb7 Investigate Ionic header collapse
- ca52590 Investigate Ionic header overlap
- 895778c Revert list header changes
- c55208d Reinstate condensed headers
- d5abefc Remove custom theming options
- 595867a Restore header collapse and contrast
- 0c46fde Update edge Docker base image
- 572ec2c Fix workflow naming and logs
- 39ecd6c Fix PWA workflow and docker build
- b16193c Update CI workflow for PWA
- 4fb89c8 Update workflow for PWA publishing
- 82c033e Fix Angular PWA configuration
- 1f81c7e Add service worker support and update manifest for PWA
- cc18a98 Explain tailscale serve status
- c3d68ac Report tailscale service status
- 9fe36e5 Fix edge image to serve Angular browser output
- 138445b Document Portainer compose env vars
- a9bbd11 Clarify docker publish workflow
- 911e909 Add GHCR publish workflow
- f872c0b Fix docker compose deploy errors
- 415c8fe Fix hltb scraper Docker build
- ce024d6 Clarify dev vs prod docker compose
- 3028780 Explain docker env vars setup
- 37ee3de Update docker compose env vars
- 7925286 Show IonFabList on explore detail
- 85f40c8 Add explore detail add-to-library
- 94a1f0a Add library action on game detail
- eca0475 Add explore detail library button
- 4ab0bb2 Adjust explore detail page UI
- 135f81d Adjust explore tabs and detail UI
- f670f82 Reorder tabs and adjust explore UI
- eedbd26 Adjust explore page layout
- ae4d1f7 Add Explore tab using IGDB popularit
- d0d28a8 Add Explore tab for popularity
- a182c3d Add Explore tab with IGDB
- 0a070a8 Add platform alias support
- 8fbb85a Update platform customization UI
- 9eb58f0 Update TheGamesDB prioritization
- a54ede9 Fix api server restart error
- 34ee7f5 Add DEBUG_HLTB_SCRAPER_LOGS env
- 0ad7afe Limit custom platform sort order
- d395207 Refactor logger configuration and improve code formatting
- e3a283b Add pino-pretty to devDependencies
- ce6f160 Restrict custom platform sort
- 34b8f31 Add platform display aliases
- c7bd36c Configure manuals server setup
- 08d7074 Update metadata validator layout
- 7e700ee Validate HLTB update flow
- 5651fbd Set ng serve start port 8100
- d2c5715 Add host dev Docker scripts
- 76318ba Update playwright dependency to version 1.58.2
- 8841749 Add fuzzy PDF manual support
- e89296e Add 429 info and clean selectors
- cb0442a Show platform dropdown on MGC import
- 206e468 Add platform selector and retry info
- e303fe6 Fix platform order sync
- 5134427 Add platform dropdown to MGC settin
- f375ff4 Fix platform sort order sync
- ef148b2 Allow custom platform sort order
- efc5a2e Fix CI coverage thresholds
- b7f2195 Improve coverage for CI
- 55b7aab Fix CI coverage threshold failure
- b3ef0f3 Add CI workflow for UI tests
- f413f81 Add Playwright UI test deps
- 5a797b9 Align filter buttons horizontally
- 4229635 Refine GameList tag actions
- a43ebc1 Refactor game list picker state
- d53f53d Fix update game image loading
- d33c334 Audit and fix game detail UI
- 435afdd Audit and fix game detail flows
- f4e29fe Fix game detail UI issues
- af515d4 Fix series metadata display
- dc46ec8 Fix similar games loading layout
- f8b9086 Improve detail text layout
- 80a0630 Add storyline and summary fields
- 3d4dead Handle metadata errors for franchise
- 36ce3e4 Add selectable metadata filters
- 7b1e9ba Enable metadata item clickability
- 2eecc7c Update game detail navigation
- 04ff94c Add series picker modal
- e4d0a97 Add detail history navigation
- dbedbe7 Add similar games section
- 872c855 Display similar games section
- b815cf9 Display similar games section
- ca4ada6 Add IGDB series data flow
- 13fc0ce Add series display and batching
- b1dabff Add series collection display
- 77a4f7d Add series collections support
- 988caf1 Add collections data support
- a4fb3aa Update game search badges
- d9367d6 Remove follows field and cover badge
- 6a8901e Remove deprecated follows field
- b94568d Verify IGDB game_type usage
- c4c1b6e Adjust HLTB filter and modals
- 8eb8581 Remove tags overflow option
- 671530f Disable auto HLTB search
- eef5181 Add manual HLTB picker to detail
- eb81dd4 Show IonLoading during HLTB update
- ba08f86 Reposition game count display
- e92d516 Update settings page styling
- e8a1dc9 Update settings icons layout
- bbd2171 Fix missing scraper logs
- 7d1c972 Fix cache path and HLTB revalidate
- 0d159b8 Fix HLTB cache route behavior
- 8c3b221 Add HLTB cache route
- 394d215 Fix server image cache path
- dfebda3 Fix server image cache
- 796f581 Validate hltb-scraper gitignores
- d1dd1f5 Update Playwright docker image
- 5f5a0fd Update Playwright image
- c6ca57f Fix dev env configuration
- fe5db80 Plan Synology NAS PWA migration
- 678c9aa Show HLTB search dialog for single
- ff17110 Fix metadata validator errors
- 0ef76ec Use IGDB covers on Windows
- 2a49dc1 Fix image flow wiring and spinner
- b7cbdad Fix image update flows and metadata
- a551e0d Fix image update change detection
- 472e8e6 Fix game detail popover behavior
- 8bd4b00 Update metadata import messaging
- 1f6c239 Add game detail fab shortcuts
- cb6490c Add web search shortcut fab
- 407696d Add detail row with full game name
- 748e77b Update tag display and filter badge
- 560bd6b Update game tags row
- 3140838 Update clear buttons styling
- 7ef6095 Add debug logging to scraper
- 7c71724 Add HLTB scraper debug logging
- 87d8051 Add debugging plus bulk game actions
- 22aa3d1 Add bulk HLTB metadata actions
- c7817aa Add Update HLTB data action
- b727b2c Add auto game search plus HLTB menu
- d3eb7e2 Fix game match search flow
- 95a97e7 Fix game match workflow
- d16bedd Add delete option in header menu
- 808c432 Improve add-game flow interactions
- 472b49f Update add game search flow
- 65ffd28 Filter HLTB scraper entries
- ade16b9 Handle 403 from hltb API
- 3de8db7 Configure env for hltb scraper
- 5abb2b7 Investigate HLTB integration
- 094009f Add dark mode theming options
- 4b83456 Reset filters menu to defaults
- 1209694 Add local game image cache
- 78fb154 Prevent NG0913 warnings on covers
- a9af30d Standardize game list grouping
- 9a1b43b Revert game list group expansion
- efebbb0 Update game cover sizing
- 440e93c Set game cover height to 350px
- 698f91e Update detail cover styling
- 98156c3 Unify IGDB rate-limit cooldown
- 7c1250f Unify IGDB rate limit handling
- 276fb83 Share list page component
- 0f214ec Fix wishlist search bar colors
- dfc4662 Force wishlist searchbar white
- 2a46255 chore: update wrangler and dependencies in package.json and package-lock.json to latest versions
- 792832f Disable Angular CLI cache
- 1b95d84 Update for standalone
- 0aba9ca Remove boilerplate code
- 45f09f4 Update vitest.config.ts: add '@ionic/angular/standalone' to inline dependencies
- 5345a30 Refactor app.module.ts: reorganize imports and add HttpClientModule with interceptors
- 34a9487 Install latest package
- 397d97f Update to Angular Standalone
- 8acb3e0 Switch to ESBuild
- 804de33 Increase retry waits and loaders
- 36d1380 Fix: Update package.json to include typescript and adjust vitest dependency
- 45b1eab Update package lock
- 2555831 Update jsdom
- ad91362 Fix: Update .ncurc.cjs to ensure 'zone.js' is treated as a patch version
- a70593b Update zone.js to version 0.15.1 in package.json and package-lock.json
- 75a95ea Fix: Update .ncurc.cjs to include 'eslint' in minor version target
- 5f218d1 Update ESLint packages
- c098dc9 Update Vitest
- 69a062d Update @types/node to version 22.19.10 in package.json and package-lock.json
- 262fda7 Add .nvmrc file to specify Node.js version 22.21.1
- 674c3a6 Update IonIcons
- ecbf4c4 Update .ncurc.cjs to include @types/node for minor version updates
- cdc2cbc Run npm update
- cb0dd59 Update packages
- 3347ea8 Add .ncurc.cjs configuration for package management
- c5a73ed Adjust rate-limit retries and tests
- a995d0f Improve IGDB rate limit handling
- 11eff53 Improve IGDB rate-limit handling
- be69078 Align alert icon and handle rate lim
- 8587aae Align MGC import icon and counters
- 13a54de Adjust settings headers and buttons
- 72c376d Add MGC CSV import flow
- 7435a50 Add MGC CSV import flow
- 2e4fb6e Add MGC CSV import handling
- 4f20f82 Add CSV import export flow
- b4b4af3 Update worker normalize test fields
- eafb1c1 Update game detail filters layout
- 8a297ea Add views and rating filter options
- c49fe85 Add views management support
- 9b4df89 Handle game row menu swipe
- ef34be3 Update game row menu labels
- 84f9499 Add IonRange pin and swipe menu
- 37a6a8b Add rating support UI enhancements
- 850f481 Add game rating controls
- 0ca9791 Add star rating UI with IonRange
- 15cb8f9 Hide popover in selection mode
- c8668f2 Prioritize country_id 50 results
- c9b0a96 Change success toast to primary
- b664c90 Update success toast color
- d9afe72 Add IGDB platform ids and rename
- 3ef1c09 Add duplicate IGDB validation
- 7f880ea Add duplicate game validation alerts
- 698c682 Adjust multiselect header menu
- f6a32d0 Fix multi select header menu
- ed4116f Update bulk selection header
- 6f5ad22 Enable collection multi-select att
- 4c48db5 Reorder tab menus and adjust icons
- 407bae9 Update game row status icons
- c16d3af Update game status icons
- 2829971 Add status filters and icons
- 4fb12e0 Update status and tag filters
- 4d7a002 Add game status controls
- fd917c9 Add game status management
- 0e435bc Add search styling and status
- 14c71c4 Adjust wishlist searchbar styling
- fbe8a35 Align IonSearchbar styling
- 099a666 Add filters and normalize sorting
- 835c1f2 Update collection filters search
- cd8ba15 Fix sorting to ignore leading A or T
- 59126b4 Add genre and tag filters
- 5700165 Fix platform select and date buttons
- 0e09ff8 Update collection sort options
- 597ff29 Persist sorting and grouping
- 79e2ac8 Persist and expand collectionsorting
- 9fef08d Add grouping layouts and sort modes
- ec4aa0a Add grouped layout options
- 2bf1fbc Add group-by options to collections
- 880aeba Adjust game art height to 90px
- ed9d485 Add tagging UI and year row
- 3711829 Add tagging system and filters
- b3681ce Add IGDB platform filter select
- 1f2d9f6 Add IGDB platform id mapping layer
- fc8de7c Add IGDB to TheGamesDB mapping
- 4dca8d7 Handle IGDB search sort conflicts
- eb2e5e7 Fix header colors and deferred box
- 9362102 Force white header icons and text
- b06b2f7 Add collection menus and theming
- 26bdae8 Add game detail modal page
- 284cbe7 Add game detail modal view
- 950da5e Add game detail modal view
- fb916d7 Update game detail modal layout
- 3def54c Add game detail modal view
- 1f000ae Constrain game artwork width
- 0104515 Select closest TheGamesDB match
- 3978b5a Adjust game list UI controls
- b9c5a67 Add filtering and popover controls
- d148076 Add filtering and search controls
- eca91f6 Add ion menu filters and modal
- fe692d2 Handle multi-platform game choice
- 5efe485 Handle multi-platform game selection
- 35f44b3 Install packages
- b1f7bfc Add /.wrangler to .gitignore
- ad6fd99 Add worker/.dev.vars to .gitignore
- f137361 Add .gitignore to exclude node_modules directory
- 1af1021 Remove example Twitch credentials from development variables
- ed54edf Build Ionic game shelf MVP
- bc68d91 Initial commit

## v0.0.3 - 2026-02-19

- a4c3f51 Add version display to settings page
- 28b33a9 Update settings page with version
- 776f3d3 Remove @capacitor/app dependency
- a0b61af Display app version in settings

## v0.0.4 - 2026-02-19

- 97d8489 Move pino-pretty to dependencies
- 05685eb Move pino-pretty dependency

## v0.0.6 - 2026-02-19

- 6b34fde Merge pull request #21 from thetigeregg/test
- cd348ca Merge branch 'main' into test
- 20b4fc1 Merge pull request #7 from thetigeregg/dependabot/github_actions/actions/setup-node-6
- 34b9970 Merge branch 'main' into test
- 40730e0 Fix release tag handling
- 0a16cf5 chore(ci): bump actions/setup-node from 4 to 6
- 3f4aac5 Merge pull request #10 from thetigeregg/dependabot/github_actions/actions/upload-artifact-6
- b8f6e32 chore(ci): bump actions/upload-artifact from 4 to 6
- 02ca46e Merge pull request #3 from thetigeregg/test
- 5e62f66 Add permissions to workflows
- 089a7ed Update workflow timezone config
- 077beef Add dependabot config and TZ env
- 1a1df7e Adjust workflows and TZ defaults
- 8c07bbb Update dependabot timezone settings
- c36d743 Add read permissions to workflows
- 64e840b Add dependabot config for repos
- 91fff1b Fix secret-scan workflow
- cf5eaa3 Audit repo for secrets and CI issues
- 8e1c22e Ensure API key removed from refs
- 5b355c4 Add public repo secret scan workflow
- fe9fec3 Enforce 80% coverage minimum
- d649432 Enforce 80% coverage minimum
- cf0a424 Enforce 80% coverage minimum

## v0.0.7 - 2026-02-19

- ca22a2a Merge pull request #11 from thetigeregg/dependabot/github_actions/actions/create-github-app-token-2
- 04ee9f4 Merge branch 'main' into dependabot/github_actions/actions/create-github-app-token-2
- 3bb4652 Merge branch 'main' into dependabot/github_actions/actions/create-github-app-token-2
- 0b51990 chore(ci): bump actions/create-github-app-token from 1 to 2

## v0.0.8 - 2026-02-19

- 330f6b8 Merge pull request #22 from thetigeregg/codex/deps
- df49d37 Add dependabot docker major rules

## v0.0.9 - 2026-02-19

- b97449a Merge pull request #6 from thetigeregg/dependabot/docker/edge/caddy-2.10-alpine
- 9f2caae Merge branch 'main' into dependabot/docker/edge/caddy-2.10-alpine
- c3530e8 Merge branch 'main' into dependabot/docker/edge/caddy-2.10-alpine
- 0ec4272 chore(docker): bump caddy from 2.8-alpine to 2.10-alpine in /edge

## v0.0.10 - 2026-02-19

- 07596a9 Merge pull request #13 from thetigeregg/dependabot/npm_and_yarn/hltb-scraper/express-5.2.1
- 9bf1d84 Merge branch 'main' into dependabot/npm_and_yarn/hltb-scraper/express-5.2.1
- 54fe978 chore(deps): bump express from 4.22.1 to 5.2.1 in /hltb-scraper

## v0.0.11 - 2026-02-19

- d75002d Merge pull request #14 from thetigeregg/dependabot/github_actions/actions/checkout-6
- 4831b46 Merge branch 'main' into dependabot/github_actions/actions/checkout-6
- 6e0c2c7 Merge branch 'main' into dependabot/github_actions/actions/checkout-6
- 887b26f chore(ci): bump actions/checkout from 4 to 6

## v0.0.12 - 2026-02-19

- 22d2197 Merge pull request #23 from thetigeregg/hltb-fix
- 692e743 Merge branch 'main' into hltb-fix
- 9aa2e9b Update backend test coverage command
- 742502c Bump app version to 0.0.10 in runtime configuration
- 7f4ed2b Refactor HLTB metadata fetching to use environment variables for base URL and token
- 94a0166 Potential fix for code scanning alert no. 13: Incomplete URL substring sanitization
- a77ac05 Merge branch 'main' into hltb-fix
- 5ab03bf Fix HLTB scraper base URL handling
- 585cc19 chore: update appVersion to 0.0.9 in runtime config

## v0.0.13 - 2026-02-19

- dff2ea9 Merge pull request #24 from thetigeregg/dep-rules
- d0caf81 Update dependabot.yml to ignore specific dependency
- f6e84bc chore(deps): ignore major version updates for @types/node

## v0.0.14 - 2026-02-19

- 0e507cf Merge pull request #4 from thetigeregg/dependabot/npm_and_yarn/server/ajv-8.18.0
- e0fcb7a Merge branch 'main' into dependabot/npm_and_yarn/server/ajv-8.18.0
- 45da2aa Bump ajv from 8.17.1 to 8.18.0 in /server

## v0.0.15 - 2026-02-19

- 70e4aa1 Merge pull request #12 from thetigeregg/dependabot/npm_and_yarn/server/dotenv-17.3.1
- f390b92 chore(deps): bump dotenv from 16.6.1 to 17.3.1 in /server

## v0.0.16 - 2026-02-19

- c791a92 Merge pull request #26 from thetigeregg/thetigeregg-patch-1
- 506b541 Add MIT License to the project

## v0.0.17 - 2026-02-19

- c5614fb Merge pull request #27 from thetigeregg/codex/backup-strategy
- 93aa388 Merge pull request #30 from thetigeregg/copilot/sub-pr-27
- b85e23e fix(scripts): derive BACKUP_HOST_DIR from docker compose config in test-backup-flow.sh
- 419e282 Initial plan
- dc1e37b Merge pull request #29 from thetigeregg/copilot/sub-pr-27-again
- 894045b Merge pull request #28 from thetigeregg/copilot/sub-pr-27
- 4c23736 fix(docker): add missing BACKUP_PGDUMP_RETRIES and BACKUP_PGDUMP_RETRY_DELAY_SECONDS to backup service env
- fa44d20 Remove volumes after test
- d69565f Initial plan
- d442a8d fix(docker): add BACKUP_PGDUMP_RETRIES and BACKUP_PGDUMP_RETRY_DELAY_SECONDS to backup service env
- 4956abd Add CPU and memory limits
- 61eee66 Initial plan
- f602b34 Clarify backup docs and checks
- 5f513f5 Improve backup validation checks
- 427a20b Improve backup startup handling
- 7a3f98e Harden backup reliability workflow
- 499c285 Ensure backup waits for postgres
- 0f5066c Fix backup script handling
- 88a5024 Ensure postgres healthy before using
- e3349f8 Add backup ops smoke test
- 9168b43 Fix docker compose backup vars
- f5a418a Retrieve backup container logs
- 1b145b1 Fix backup container restart logging
- 9948ce0 Add manual backup trigger docs
- bfeec98 Document backup service setup

## v0.0.18 - 2026-02-19

- e2c6f3f Merge pull request #31 from thetigeregg/codex/backup-strategy
- 16f47d0 Merge pull request #34 from thetigeregg/copilot/sub-pr-31
- 24e0a8a Apply suggestions from code review
- cea0c5f docs(nas-deployment): add backup image to GHCR pre-deploy checklist
- d49693e Initial plan
- b926152 Merge pull request #33 from thetigeregg/copilot/sub-pr-31-again
- dbad985 Merge pull request #32 from thetigeregg/copilot/sub-pr-31
- ca5f059 fix(docker): remove redundant command override from backup service in compose files
- 543cd4c fix(docker): remove redundant command override from backup service
- 2768223 Initial plan
- 526ae74 Initial plan
- 901b08f Merge branch 'main' into codex/backup-strategy
- feb838d Add backup image deployment docs

## v0.0.19 - 2026-02-19

- 01a6740 Merge pull request #35 from thetigeregg/dependabot/npm_and_yarn/hono-4.12.0
- 9c4461e chore(deps): update vitest and related dependencies in package-lock.json
- 36671ba chore(deps): bump hono from 4.11.9 to 4.12.0

## v0.0.20 - 2026-02-19

- 96658e8 Merge pull request #17 from thetigeregg/dependabot/npm_and_yarn/eslint-plugin-jsdoc-62.6.1
- c65b476 chore(deps): update vitest and related dependencies in package-lock.json
- 73795b8 chore(deps): bump eslint-plugin-jsdoc from 62.6.0 to 62.6.1

## v0.0.21 - 2026-02-19

- 0d65a6d Merge pull request #46 from thetigeregg/codex/manual-match
- 782f7dc Add manual bind clear option

## v0.0.22 - 2026-02-19

- 1bf340d Merge pull request #43 from thetigeregg/alert-autofix-11
- 3fab720 Refactor normalizeProxyImageUrl to construct canonical URLs with server-controlled host and path prefix
- c995631 Fix image proxy forgery tests
- 3840082 Merge branch 'main' into alert-autofix-11
- ff1adcc Merge branch 'main' into alert-autofix-11
- 6c12791 Merge pull request #45 from thetigeregg/copilot/sub-pr-43-again
- 875c11d Merge pull request #44 from thetigeregg/copilot/sub-pr-43
- e1a0fb3 test(image-cache): add port validation tests for normalizeProxyImageUrl
- 27c6ebc fix(security): prevent SSRF via HTTP redirects in image proxy fetch
- d665c91 Apply suggestions from code review
- b9ae1b1 Initial plan
- f6f0317 Initial plan
- c6b561c Potential fix for code scanning alert no. 11: Server-side request forgery

## v0.0.23 - 2026-02-20

- 6fa87de Merge pull request #47 from thetigeregg/alert-autofix-10
- 7b8c447 Potential fix for code scanning alert no. 10: Incomplete URL substring sanitization

## v0.1.0 - 2026-02-20

- 1256f30 Merge pull request #48 from thetigeregg/alert-fix-22
- 8ca2f85 Restore image cache purge rate limit
- f3dc2ec Merge pull request #52 from thetigeregg/copilot/sub-pr-48-yet-again
- 71bbc01 Merge pull request #50 from thetigeregg/copilot/sub-pr-48-again
- 05a9d65 Merge pull request #49 from thetigeregg/copilot/sub-pr-48
- 400e83d Merge pull request #51 from thetigeregg/copilot/sub-pr-48-another-one
- 65018f5 docs: document in-memory rate limiter limitation for multi-instance deployments
- 650b08b fix(image-cache): add periodic cleanup to prevent rate limiter memory leak
- 4d07ff2 feat(config): expose image cache rate limit options via environment variables
- 0e075d8 test(image-cache): add rate limit test for purge endpoint
- af5813f Initial plan
- 6a91101 Initial plan
- d3c7ebc Initial plan
- 5cd8973 Initial plan
- 70a68f9 Apply suggestions from code review
- f8f41d5 Add rate limiting to image cache

## v0.1.1 - 2026-02-20

- 48595b8 Merge pull request #53 from thetigeregg/alert-autofix-2
- 4bd58a3 Tune cache stats rate limits
- 6ed3957 Adjust cache observability rate limi
- f51afe0 Add rate limiting middleware
- 8fb4028 Add inline rate limit config
- 25cb48d Fix cache observability registration
- 4fa3432 Apply suggestions from code review
- 5be5ff6 refactor: update rate limiting implementation in cache observability routes
- 876800e refactor: improve formatting and structure of registerCacheObservabilityRoutes function
- ba7828f Potential fix for code scanning alert no. 19: Missing rate limiting
- 1ff9bdb Add @fastify/rate-limit dependency to enhance rate limiting functionality
- f4c03f7 Potential fix for code scanning alert no. 2: Missing rate limiting

## v0.1.2 - 2026-02-20

- 161e392 Merge pull request #54 from thetigeregg/angular-21
- 3b88539 Merge branch 'main' into angular-21
- c0f31f0 chore: refine versioning rules for Angular-related packages in .ncurc.cjs
- 4db2c65 chore(deps): upgrade @angular/cdk to version 21.1.5
- 8271f31 chore(deps): update @angular-eslint packages to version 21.2.0
- 652be68 chore: upgrade Angular dependencies to version 21.x and adjust configurations

## v0.1.3 - 2026-02-20

- 6d471e1 Merge pull request #55 from thetigeregg/hono-fix
- 21affc2 chore: update hono package to version 4.12.0

## v0.1.4 - 2026-02-20

- c8db52c Merge pull request #56 from thetigeregg/auth-fix
- 0cdb786 Audit rate limiting for endpoints
- f847eda Apply suggestions from code review
- bf31666 Add auth rate limiting
- 3c0e7d6 Merge branch 'main' into auth-fix
- 23a295a Audit manual refresh endpoint access
- 5b7a340 Normalize request path for auth

## v0.1.5 - 2026-02-20

- d54ed48 Merge pull request #57 from thetigeregg/img-c
- e004df1 Add rate limiting to server routes
- bde7baf Merge branch 'main' into img-c
- a1016be Add rate limiting to image cache API

## v0.1.6 - 2026-02-20

- ed89f22 Merge pull request #59 from thetigeregg/hltb-c
- ea13022 Add rate limits to server routes

## v0.1.7 - 2026-02-20

- 6cad856 Merge pull request #60 from thetigeregg/api
- adec991 Prevent duplicate middie setup

## v0.1.8 - 2026-02-20

- 6ed034f Merge pull request #61 from thetigeregg/dupe-ci
- ee3d5ea Prevent duplicate CodeQL runs
- b50d8fd Prevent duplicate CodeQL runs on

## v0.1.9 - 2026-02-20

- 9f5191e Merge pull request #62 from thetigeregg/codex/vars
- 4bbb169 Apply suggestions from code review
- 3c9ab18 Review env var sweep before merge
- b3c312d Fix manual load proxy
- 899ce18 Document manual proxy setup
- 1e44186 Fix database auth failure
- da464cd Fix missing DATABASE_URL env
- 123810b Update dev log watching script
- ee3f33a Update backend log script
- c991abb Update dev env scripts and logs
- 0887b64 Add env setup documentation
- b24ff1e Document nas secret setup
- ba2b68c Drop CLI API mode and env files
- 97a7e45 Update docker dev stack docs
- dc14e18 Apply suggestions from code review
- d9aff93 Merge branch 'main' into codex/vars
- acf4730 Move sensitive vars to secret files
- acce039 Merge branch 'main' into codex/vars
- 0d67382 Merge branch 'main' into codex/vars
- 741373e Move compose secrets from env

## v0.1.10 - 2026-02-20

- f3095cd Merge pull request #63 from thetigeregg/mans
- f3a8368 Merge pull request #64 from thetigeregg/copilot/sub-pr-63
- 4927a7e docs(nas-deployment): mark SECRETS_HOST_DIR as required for Portainer
- bf4bebf Initial plan
- bb14cd9 Adjust manual cache headers
- 6434bf5 fix(docker-compose): standardize secrets directory path across services

## v0.1.11 - 2026-02-20

- 84ba1a9 Merge pull request #65 from thetigeregg/fix
- 42943dd Add periodic health snapshot
- fb6da41 Update health rate limiter
- 998f715 Refactor health endpoint rate limit
- ee3d235 Fix missing rate limiting alerts
- d82233c Fix missing rate limiting
- 4780811 Merge branch 'main' into fix
- c909b62 Fix js missing rate limiting issues

## v0.1.12 - 2026-02-21

- af66dcf Merge pull request #69 from thetigeregg/cov
- 2341384 Add fastify rate limit dependency
- 4f70e1d Register rate-limit plugin
- 4aac3f6 Fix cache rate limit registration
- 9f14081 Implement rate limit instructions
- 30537c1 Fix HLTB rate limit config
- 95a84d1 Implement rate limit plugin
- 434323b Fix rate limit for HLTB search

## v0.1.13 - 2026-02-21

- 37fe429 Merge pull request #73 from thetigeregg/test
- b17c9c6 Re-enable CodeQL

## v0.1.14 - 2026-02-21

- f49661e Merge pull request #66 from thetigeregg/auth-fix
- ce3c900 Add peer dependency flag to multiple packages in package-lock.json
- 35a1153 Add validateSecurityConfig call
- 23f9349 Update server/src/index.ts
- ca78761 Update server/src/config.ts
- f64be12 Merge branch 'main' into auth-fix
- ec53121 Merge branch 'main' into auth-fix
- b4334c9 Merge pull request #68 from thetigeregg/copilot/sub-pr-66-again
- cdca632 Merge branch 'auth-fix' into copilot/sub-pr-66-again
- 408510d Merge pull request #67 from thetigeregg/copilot/sub-pr-66
- f73398e fix(security): use timingSafeEqual for token comparison in request-security.ts
- 076bdf9 fix(security): use constant-time comparison for token validation
- 0851e57 Initial plan
- c6ccb63 Initial plan
- 021957a Initial plan
- 3dc5f50 Add client write interceptor tests
- c56c71d Remove proxy auth header injection
- bb426de Merge branch 'main' into auth-fix
- d3147ec Clarify auth headers for edge

## v0.1.15 - 2026-02-23

- 0fe5e4f Merge pull request #74 from thetigeregg/dependabot/npm_and_yarn/types/node-22.19.11
- f102875 chore(deps): add chokidar and readdirp as peer dependencies in multiple packages
- bada9be chore(deps): bump @types/node from 22.19.10 to 22.19.11

## v0.1.16 - 2026-02-23

- 55a4f10 Merge pull request #76 from thetigeregg/dependabot/npm_and_yarn/capacitor/cli-8.1.0
- 6b66dd8 chore(deps): update @capacitor/core to 8.1.0 and @capacitor/status-bar to 8.0.1
- 8748f40 chore(deps): add chokidar and readdirp as peer dependencies in multiple packages
- a8d4d9e chore(deps): bump @capacitor/cli from 8.0.2 to 8.1.0

## v0.1.17 - 2026-02-23

- e78b80a Merge pull request #77 from thetigeregg/dependabot/npm_and_yarn/zone.js-0.16.1
- 1d846a4 chore(deps): add chokidar and readdirp as peer dependencies in multiple packages
- 20528ba chore(deps): bump zone.js from 0.15.1 to 0.16.1

## v0.1.18 - 2026-02-23

- c59efff Merge pull request #78 from thetigeregg/codex/move-device-write-token-to
- 95c06d3 Relocate device write token section

## v0.1.19 - 2026-02-23

- e3707b5 Merge pull request #79 from thetigeregg/codex/cov
- 74d2e8d Merge branch 'main' into codex/cov
- 74f854f Add Codecov uploads for monorepo

## v0.1.20 - 2026-02-23

- ea85963 Merge pull request #80 from thetigeregg/codex/preserve-last-view-filters-on
- a046d2a Add tests for invalid prefs handling
- 2d2c9a3 Add wishlist filter persistence test
- 39e1152 Preserve filters across launches
- 5c20391 Add persistence tests for filters
- d48d220 Add list view preference tests
- 9df18f4 Restore preserved list filters

## v0.1.21 - 2026-02-23

- 55129d7 Merge pull request #81 from thetigeregg/codex/whitelist-platforms-for-buttons
- 79fc09c Restrict manual buttons by platform
- e10105f Merge branch 'main' into codex/whitelist-platforms-for-buttons
- af42b28 Limit manual buttons to whitelisted
- 95dc007 Restrict manual buttons to whitelis
- 8a9770c Whitelist platforms for buttons

## v0.1.22 - 2026-02-23

- 41ea9cc Merge pull request #82 from thetigeregg/codex/document-game-detail-filtering
- 7c8267b Add genre metadata filter coverage
- 3738e7d Add genre metadata filtering
- c951f63 Merge branch 'main' into codex/document-game-detail-filtering
- 0b0d88b Add genre filter trigger on detail
- 8d414c9 Add genre filter navigation

## v0.1.23 - 2026-02-24

- fc5b412 Merge pull request #83 from thetigeregg/deps
- c73f620 Update package-lock.json
- 059cfa4 chore(deps): update @angular-devkit/core, @angular-devkit/schematics, and ajv to latest versions
- 1169131 chore(deps): update Angular and ESLint dependencies to latest versions

## v0.1.24 - 2026-02-24

- ac7b425 Merge pull request #84 from thetigeregg/codex/add-to-library-conditions
- f035295 Merge branch 'main' into codex/add-to-library-conditions
- 743a0b9 Display platforms on explore detail
- 463014e Show extra platforms on explore
- 99f6561 Document explore game add button

## v0.1.25 - 2026-02-24

- 681b7e1 Merge pull request #85 from thetigeregg/codex/add-drop-shadow-to-game
- d7b0af6 Add game detail image shadow

## v0.1.26 - 2026-02-24

- acec45e Merge pull request #86 from thetigeregg/codex/responsive-layout-support
- 4f0e7cf Switch explore header to normal
- 04b4bc1 Fix split pane smoke test
- 07309cd Fix phone layout cutoff regression
- 84b3b90 Reapply "Fix split pane overflow"
- 9cb7eba Revert "Fix split pane overflow"
- 8a1e374 Bump app version to 0.1.25 in runtime config
- 6e46bbf Fix split pane overflow
- 705c700 Fix split pane layout scrolling
- 9111be8 Implement IonSplitPane desktop mode
- 6bc4372 Add IonSplitPane desktop layout
- 242fcaf Plan desktop responsive layout

## v0.1.27 - 2026-02-24

- 20c18e4 Merge pull request #87 from thetigeregg/codex/responsive-layout-support
- 49cc006 Apply suggestions from code review
- 1b331a2 Merge branch 'main' into codex/responsive-layout-support
- 30b3528 Add mobile filters e2e coverage

## v0.1.28 - 2026-02-24

- dcbadd4 Merge pull request #88 from thetigeregg/codex/hiding-manual-buttons
- a59c2cb Hide manual buttons behind platform

## v0.1.29 - 2026-02-24

- 7951ff3 Merge pull request #89 from thetigeregg/codex/fix-runtimeconfig-referenceerror
- 4e8f4a9 Merge branch 'main' into codex/fix-runtimeconfig-referenceerror
- 2256919 Fix runtime-config feature flag

## v0.1.30 - 2026-02-24

- b6bb056 Merge pull request #90 from thetigeregg/codex/fix-runtimeconfig-referenceerror
- fb97924 Merge branch 'main' into codex/fix-runtimeconfig-referenceerror
- 329d179 Fix runtime config append error

## v0.1.31 - 2026-02-24

- 325673a Merge pull request #91 from thetigeregg/codex/fix-runtimeconfig-referenceerror
- f61b043 Merge branch 'main' into codex/fix-runtimeconfig-referenceerror
- 5734c82 Fix runtime config stray n

## v0.1.32 - 2026-02-25

- 21f53ec Merge pull request #92 from thetigeregg/codex/responsive-layout-support
- 0c79b6d Add desktop and mobile e2e matrix
- 154ea57 Limit desktop fullscreen modals
- d2bff0c Add mobile filters test coverage
- 50b1f95 Add desktop fullscreen modals

## v0.1.33 - 2026-02-26

- f51d0f4 Merge pull request #93 from thetigeregg/codex/notes-system-for-games
- cc91faf Update env feature flags
- 1db4fb7 Prune coverage artifacts from git
- 05e3723 Centralize notes sanitization helper
- c87ee61 Centralize note sanitization
- 99a46bf Centralize note sanitization helper
- b7f41de Add window declaration for zone flag
- 165f739 Fix server lint failures
- bb1e750 Update eslint config and lint
- 8706d8c chore: update ESLint configuration to use TypeScript ESLint configs and improve test environment setup
- aacd729 chore: update eslint and typescript-eslint dependencies to latest versions
- fcfb1c4 chore: add vitest types to tsconfig for improved type support
- 4ac044d Validate eslint config updates
- 5b771d5 Lint codebase
- 6b70b04 chore: enhance ESLint configuration with TypeScript parser and file patterns
- a842ac8 chore: integrate eslint-plugin-import-x and eslint-plugin-unused-imports for improved linting
- 5d12082 chore: add eslint-plugin-unused-imports to devDependencies
- d494747 chore: update ESLint dependencies and add TypeScript resolver
- 44b5a1b Remove redundant note dirty return
- 7b4722d Check runtime env override order
- 44d7ab0 Guard notes on breakpoint change
- b6cb9f9 Prevent notes data loss during resiz
- 5b3cd68 Guard notes across breakpoints
- b4ffb93 Default e2eFixtures flag off
- 7818845 Set e2eFixtures flag false
- 1198dc2 Align notes normalization trimming
- 24a8feb Consolidate notes normalization
- 67ba094 Extract shared note normalization
- b3a8f35 Evaluate Copilot AI feedback
- dcfbea2 Add newline to <br> test
- 0a7907d Limit autosave retries
- 8cb679a Limit autosave retry attempts
- 67590c5 Clarify notes editor reuse
- 5730d27 Document escapeHtml purpose
- 484f278 Clarify autosave timeout handling
- 88be6b9 Assess Copilot suggestions
- 01fac96 Disable e2e fixtures flag
- 0828ae3 Validate fixture game input
- 55d9508 Normalize notes before compare
- 725f2d0 Expand normalizeNotes empty patterns
- 75d41df Preserve whitespace during note sync
- 19f1aba Add @tiptap/extension-underline dependency
- d8d2944 Review notes normalization logic
- c1d95d2 Preserve note whitespace on sync
- 07a894e Handle empty paragraph variants
- 04792dc Expand notes import empty detection
- d6af6f4 Gate fixture reset behind flag
- 43c44b9 Gate fixture DB init
- 73151f9 Gate applyFixtureFromStorage
- 3d96add Gate fixture initialization flag
- 72a5532 Gate e2e fixture initialization
- 41291c2 Sanitize normalized text output
- fd2cb8d Add dompurify and its types as dependencies
- 6ecb31a Fix backend coverage failures
- d9e15d1 Align notes normalization with the
- e1a9af2 Merge branch 'main' into codex/notes-system-for-games
- 7793b99 Apply suggestions from code review
- 96fc648 Audit notes implementation
- 59d47cc Review notes implementation
- 9624ce9 Align desktop detail layout heights
- 1a2bcb5 Adjust detail layout column widths
- 471ed63 Adjust game detail column widths
- b0091ba Move similar games content
- bd92831 Reapply IonGrid layout in GameDetail
- 26dcb8e Register themed colors for fab
- 152ce0e Register ocean palette colors
- 1b65882 Register IonFabList color vars
- 706935f Register ocean palette colors
- 7947a46 Adjust split pane header offset
- bef2b28 Update desktop notes menu
- 36cd496 Set notes pane size to 40vw
- b202c9a Automate note saving behavior
- 27f4f68 Auto-save editor notes
- 2d3b56d Update toolbar button styles
- d5ed664 Update toolbar button styling
- eae54d6 Update toolbar toggle styles
- 1b81c28 Update toolbar button fill states
- 5210ee6 Prefill tiptap editor notes
- 32fbde7 Fix tiptap note prefill
- e0d13da Adjust list padding in editor
- 889adfd Adjust detail list spacing
- 0f96feb Fix details layout padding
- 576e2b3 Fix detail summary rendering
- 7291494 Adjust details block spacing
- 1b12959 Fix details block rendering
- 85fbd50 Add Details toolbar button
- d95e52a Add @tiptap/extension-details dependency
- 34bef11 Add @tiptap/extension-list dependency
- 20dc3ef Restore task list indentation
- f6c51f8 Restore task list indentation
- 4e6c6a1 Enable nested TaskItem support
- b2b1004 Update toolbar icons
- a70add5 Update toolbar icons and tasks
- fa4f101 Update toolbar icons
- 939016c Add remixicon dependency to package.json and package-lock.json
- 689e588 Fix tiptap editor height
- 7c6bd83 Fix tiptap editor styling issues
- 6372990 Simplify note modal editor styling
- eae67ab Update note editor layout
- 832f4b3 Integrate TipTap rich editor
- 77dd546 chore: update dependencies to include Tiptap packages
- e45dcd0 Align note actions in footer
- 48b1154 Replace numbered list icon glyph
- c179d0c Update formatting toolbar icons
- 69b3d00 Move format toolbar into header
- 6363aae Use icons in notes toolbar
- e9e50da Add per-game notes support
- 34b3265 Add per-game notes system
- 5e608f7 Add per-game notes system

## v0.1.34 - 2026-02-26

- 01387df Merge pull request #98 from thetigeregg/codex/prevent-notes-page-header-from
- b598eac Fix notes page scrolling

## v0.1.35 - 2026-02-26

- 3245dcf Merge pull request #97 from thetigeregg/codex/fix-notes-toolbar-button-newline
- a88951f Add edge-case tests for notes normal
- 23b7919 Remove i flag from regex
- c11b850 Merge branch 'main' into codex/fix-notes-toolbar-button-newline
- fa8cabe Merge branch 'main' into codex/fix-notes-toolbar-button-newline
- b481c5d Revert initial notes fix
- c8848e9 Fix notes regex sanitization
- 4ae755d Fix notes sanitization regex
- 8dfbc36 Fix notes regex flag
- fd55cb4 Revert notes sanitization fix

## v0.1.36 - 2026-02-26

- 4175f3a Merge pull request #99 from thetigeregg/codex/fix-note-content-clearing-issue
- 2dcb1a6 Sanitize notes normalization input
- 5a7cf0a Fix empty note clearing bug
- 17bd960 Fix notes normalization parser
- 9f6eb18 Store structure-only rich notes
- 2e530ae Prevent empty notes from clearing

## v0.1.37 - 2026-02-26

- 7e9a312 Merge pull request #100 from thetigeregg/codex/logerr
- cbf3201 Increase coverage for sync/manual
- aac1aea Normalize manual debug errors
- 8b9d3f5 Add ok field to normalizeUnknownErro
- 86ccf40 Extract shared error normalizer
- a5c320e test(core): add sync/manual diagnostics coverage
- 9c1ea7c refactor(game-list): normalize manual resolve errors in debug logs
- 37102a4 refactor(core): share HTTP error normalization utility
- 69f5709 fix(game-list): remove getter-based manual visibility logging
- 05dee8f fix(debug): prevent XHR recursion and add sync/manual diagnostics

## v0.1.38 - 2026-02-27

- 0a5981e Merge pull request #101 from thetigeregg/codex/adjust-collection-sort-options
- 193ef1b Review missing coverage for filters
- d1761ee Add title fallback sorting test
- caba72c Add HLTB sort and repositionPlatform
- 9bdb8ed Add HLTB sort ordering option

## v0.1.39 - 2026-02-27

- ecaf13d Merge pull request #103 from thetigeregg/deps
- 11f5e94 Add repo-wide npm scripts
- c833710 chore(deps): update @angular-devkit/core, @angular-devkit/schematics, ajv, and minimatch to latest versions
- 1d6d7ff chore(deps): update Angular and Capacitor dependencies to latest versions

## v0.1.40 - 2026-02-27

- 0a7dce3 Merge pull request #104 from thetigeregg/codex/add-exclusion-filters-accordion
- 8115ac3 Generate PR title and summary
- b0be461 Add exclusion filters accordion
- ae225c7 Add exclusion filters accordion
- 5eb88d8 Add exclusion filters accordion

## v0.1.41 - 2026-02-27

- e611a1b Merge pull request #105 from thetigeregg/codex/fix-production-search-execution
- dc5c539 Fix frontend game fetch response
- 678ebdc Fix frontend contract response
- 12547d1 Fix contract mismatch handling

## v0.1.42 - 2026-02-27

- 72e9267 Merge pull request #106 from thetigeregg/codex/metacritic
- 35b5b76 Add missing tests for coverage
- 8f7fe00 Improve metacritic integration tests
- 342b946 Add metadata validator coverage
- 67e2401 Update metacritic platform support
- a7b148f Add Metacritic score sorting
- f6c5725 Audit Metacritic sync gaps
- 93d95ca Add Metacritic sorting option
- 23a30d4 Handle IGDB rate limit errors
- 7659df4 Handle metacritic bulk rate limits
- 433c07f Skip unsupported Metacritic games
- 860fdaf Display metacritic score badge
- ee7ac29 Add Metacritic score badge styles
- e01f531 Update Metacritic display and colors
- b1e7e7a Update Metacritic UI colors
- fdcfe91 Fix platformIgdbId type error
- 70bf5f2 Add platformIgdbId typing fix
- 2beb972 Fix platform IgdbId build error
- ad5b7ed Fix metadata validator build
- e36b1ea Describe new mapping behavior
- ddbde69 Add IGDB platform display mapping
- 653ad6e Refine Metacritic scraper filtering
- 083239f Normalize roman numeral titles
- c82dffb Normalize Metacritic score parsing
- ab7379b Normalize accented metacritic titles
- 055476c Adjust series ranking penalties
- 13ff3d5 Add edition variant token
- 6c9a841 Refine variant detection logic
- 48a938e Adjust variant token scoring
- 78a5e84 Improve Metacritic platform parsing
- 656957d Filter Metacritic results to games
- 04a48e6 Preserve Metacritic UI aspect ratio
- 1aefe0c Improve Metacritic platform matching
- e49df5b Restore Metacritic cover aspect
- d13e385 Use category param in search
- 769fddd Normalize Metacritic search queries
- 3e6bc9c Implement Metacritic pipeline
- eec6843 Add package lock
- ec09885 Add Metacritic pipeline parity
- 5bac7ed Add metacritic pipeline parity

## v0.1.43 - 2026-02-27

- 1359a62 Merge pull request #107 from thetigeregg/codex/fix-build-fail-issue
- b5c49b3 Add config copy to edge build

## v0.1.44 - 2026-02-27

- 64eacdb Merge pull request #108 from thetigeregg/codex/fix-build-fail-issue
- cbce0cf Merge branch 'main' into codex/fix-build-fail-issue
- 0dc66ab Copy metacritic scraper src

## v0.1.45 - 2026-02-28

- b3c7be8 Merge pull request #115 from thetigeregg/copilot/set-up-copilot-instructions
- cb0e8a1 docs(copilot): set up comprehensive Copilot instructions
- b166f8e Initial plan

## v0.2.0 - 2026-03-01

- ece258f Merge pull request #109 from thetigeregg/codex/add-mobygames-api-support
- 88d2240 Merge pull request #138 from thetigeregg/copilot/sub-pr-109-again
- cc42703 fix(metadata-validator): pass mobygamesGameId and platformIgdbId through review candidate query
- ffa7afd Merge pull request #137 from thetigeregg/copilot/sub-pr-109
- d8c2922 refactor(test): remove duplicate top-level tests from html-sanitizer spec
- b13381a Initial plan
- 8e182ca Initial plan
- b32fdac Merge pull request #136 from thetigeregg/copilot/sub-pr-109
- bd1cd24 fix(metadata-validator): key dedupeReviewCandidates by stable identity fields only
- 08197a4 Initial plan
- f54f4b8 Merge pull request #135 from thetigeregg/copilot/sub-pr-109-again
- 1da693c Merge pull request #134 from thetigeregg/copilot/sub-pr-109
- ee63652 fix(ui): preserve one decimal place in normalizeReviewScore
- 774a54a fix(settings): infer mobyScore from raw reviewScore in CSV import
- 9584320 Initial plan
- 8010da9 Initial plan
- 2b84c19 Merge pull request #131 from thetigeregg/copilot/sub-pr-109
- dc278a0 Merge pull request #132 from thetigeregg/copilot/sub-pr-109-again
- f49642e Merge pull request #133 from thetigeregg/copilot/sub-pr-109-another-one
- 59a14cc fix(db): gate v8 metacritic backfill when reviewSource is mobygames
- 24876b2 fix(settings): widen MobyGames score normalization tolerance to <= 0.05 in CSV import
- ec90fca refactor(filtering): remove hasMetacriticData alias, use hasReviewData directly
- 4d19b1f Initial plan
- 17a6490 Initial plan
- cac765f Initial plan
- f61e805 Merge pull request #129 from thetigeregg/copilot/sub-pr-109
- 3aced18 Merge pull request #130 from thetigeregg/copilot/sub-pr-109-again
- 7d1b2a6 fix(filtering): use mobyScore as ground truth for MobyGames 0–10 scale detection in sort
- 0bdede5 fix(import): parse mobyScore before reviewScoreForCatalog in CSV import
- 14512e0 Initial plan
- 6b32739 Initial plan
- a1f40e4 Merge pull request #127 from thetigeregg/copilot/sub-pr-109
- 481e5e6 Merge pull request #128 from thetigeregg/copilot/sub-pr-109-again
- 962acea fix(sync): normalize MobyGames reviewScore from 0–10 to 0–100 in applyGameChange
- f35b5c1 fix(filtering): make review score sort source-aware for MobyGames 0–10 scale
- c608a4c Initial plan
- 433738a Initial plan
- f837064 Merge pull request #125 from thetigeregg/copilot/sub-pr-109
- 877c8e1 Merge pull request #126 from thetigeregg/copilot/sub-pr-109-again
- ea09b81 fix(data): use existing.metacriticScore/Url as fallback in upsertFromCatalog
- b6c617a fix(workflow): key dedupeReviewCandidates by stable identity fields only
- c046d2b Initial plan
- 6835403 Initial plan
- 37d848c Merge pull request #124 from thetigeregg/copilot/sub-pr-109
- 3216375 fix(settings): fix reviewScore upper bound and mobyScore zero validation in CSV import
- fffe2b5 Initial plan
- a34d305 Merge pull request #123 from thetigeregg/copilot/sub-pr-109-another-one
- cdd2bbb Merge pull request #122 from thetigeregg/copilot/sub-pr-109-again
- dda5b7c feat(data): introduce normalizeReviewScore() preserving decimal scores
- ebff8ea fix(sync): use normalizeReviewScore to preserve decimal precision in sync payloads
- 9a1e118 Merge pull request #121 from thetigeregg/copilot/sub-pr-109
- 53b8cd8 fix(settings): allow MobyGames scores 0–10 in CSV import validation
- fef35dd Initial plan
- 3749222 Initial plan
- 367d801 Initial plan
- 8b48ef5 Merge pull request #120 from thetigeregg/copilot/sub-pr-109
- b16078b test(server): fix mobygames cache test expectation for BYPASS header on short query
- 83a8ea7 Initial plan
- 8e7d4be Merge pull request #117 from thetigeregg/copilot/sub-pr-109
- 98fae2c test(coverage): add backend tests for mobygames cache, http debug, and sync service review fields
- 8c6b012 test(coverage): add targeted tests to improve patch coverage across frontend files
- 430e1f0 Merge pull request #119 from thetigeregg/copilot/sub-pr-109-another-one
- 3e40eeb Merge pull request #118 from thetigeregg/copilot/sub-pr-109-again
- f08598e fix(settings): infer reviewSource from URL when not explicitly set in CSV import
- 4983ac4 fix(data): preserve existing metacritic score/url on partial upsert
- aec4876 Update server/src/mobygames-cache.ts
- 32f2b5e Initial plan
- 1765736 Initial plan
- e6770c7 Initial plan
- c732b94 chore: remove unused import from mobygames-cache.test.ts
- 88a6749 chore: add chokidar and readdirp as optional dependencies in package-lock.json
- d26aa50 Merge branch 'main' into codex/add-mobygames-api-support
- c89345c chore: update dependencies for @fastify/cors, @fastify/middie, fastify, pg, and type definitions
- d987251 test: add unit tests for runtime configuration, layout mode, and theme services
- fd5120b Merge pull request #112 from thetigeregg/copilot/sub-pr-109-again
- 82f17e9 Merge branch 'codex/add-mobygames-api-support' into copilot/sub-pr-109-again
- df19c2a test(coverage): add tests to bring backend branch coverage above 80% threshold
- 317ef54 Merge pull request #113 from thetigeregg/copilot/sub-pr-109
- 0c788a4 fix(lint): fix ESLint errors in http-debug-log and mobygames-cache test files
- 12168e2 chore(plan): outline lint fix approach for test files
- 12b2708 Initial plan
- 440a1d1 Merge pull request #111 from thetigeregg/copilot/sub-pr-109
- e13ef46 test(coverage): add mobygames stale/error path tests and http-debug-log test file to meet 80% branch threshold
- 15d0e5d chore(plan): outline UI test fix approach
- 9c275eb Initial plan
- c42fbc0 Initial plan
- 80e67f5 Merge pull request #110 from thetigeregg/copilot/sub-pr-109
- 0c0401c chore(deps): restore package-lock.json to base branch state
- 87a4a20 test(coverage): fix failing coverage thresholds with new unit tests and config
- 7706f0f chore(plan): outline coverage threshold fix approach
- b28a90a Initial plan
- cd6ba3a test: add unit tests for game list features and settings utilities
- 20d4c8e docs(copilot): update instructions for commit messages and pull requests
- 9b8dae7 Update mobygames request test
- aebea61 Review mobyScore validation
- ecfec07 Validate mobyScore range
- 449fa3d Validate mobyScore and reviewScore
- 354dbeb Fix moby score validation
- 41df8dc Enforce positive moby scores
- 81dd369 Replace manual review source heur
- b9a38be Audit settings implementation gaps
- 0925afc Audit review score handling
- 4e537a2 Store raw moby score values
- 5a4cab0 Avoid mobygames screenshots
- 93de94c Skip caching empty Mobygames covers
- 2016bbe Investigate cache miss after clear
- 1e92249 Document DEBUG_HTTP_LOGS logging
- 405cab2 Add Mobygames cover data
- 3ea22eb Show review score fractions
- 362dabc Switch Mobygames API to v2
- 3b356c0 Switch mobygames API back to v2
- 2bc1c0d Switch mobygames api defaults
- 06e1f9f Update Mobygames cache params
- fafa176 Update mobygames API base URL
- 2f56bcd Fix mobygames API path
- 68be1c1 Document review score sources
- f44c687 Show review source label
- 44413d7 Format Metacritic platform utils
- 49d8a17 test(review): add e2e source-routing checks and align picker typing
- ff6d495 Add review refresh routing tests
- 7d5d0dc test(review): add routing and migration regression coverage
- 501e8aa Rename metacritic pipeline refs
- 7309f4c Add mobygames review pipeline
- b5107dc Add review pipeline and attributions
- 3aab956 Integrate review pipeline updates
- 76e72a4 Implement MobyGames integration
- 5e08306 Add attributions alert section
- 8c3c52e Add mobygames for legacy platforms
- eeb46b0 Add MobyGames API integration

## v0.2.1 - 2026-03-01

- b362c8c Merge pull request #139 from thetigeregg/copilot/review-rate-limiting-logic
- 7765750 fix(api): revert overly conservative bulk metacritic constants; cooldown guard handles MobyGames 429s via retry
- c551f4e fix(api): enforce rate-limit cooldown in lookupReviewScore and lookupReviewCandidates, respect MobyGames 12 req/min in bulk actions
- db183bc Initial plan

## v0.2.2 - 2026-03-01

- 25bcd92 Merge pull request #140 from thetigeregg/copilot/fix-mobygames-rate-limiting
- 92dc2a5 fix(server): restore retry-after header in MobyGames 503 queue-full response using actual delay
- e6dcb7b Update src/app/core/api/igdb-proxy.service.ts
- f2bd342 Update server/src/mobygames-cache.ts
- 98217c2 Update src/app/core/api/igdb-proxy.service.ts
- 969ecf5 fix(api): make MobyGames slot reservation cancellation-safe via releaseSlot rollback
- 51079aa Update src/app/core/api/igdb-proxy.service.ts
- 4c144ba test(api): add coverage for MobyGames throttle error paths and waitForMobyGamesSlot delay branch
- b8fd3b9 fix(api): move MobyGames lookup_request traces inside defer blocks for accurate timestamps
- 5cb0fc7 Update src/app/core/api/igdb-proxy.service.ts
- 14c0ddb fix(api): address PR review feedback on MobyGames throttle
- 4abde13 Update server/src/mobygames-cache.test.ts
- 200324a fix(server): add server-side outbound throttle for MobyGames (5 s minimum interval)
- 5c14259 fix(api): proactively throttle MobyGames requests to 0.2 req/s
- fd5eb51 Initial plan

## v0.2.3 - 2026-03-02

- 6e61ec6 Merge pull request #144 from thetigeregg/dependabot/github_actions/actions/upload-artifact-7
- 8cb99a2 chore(ci): bump actions/upload-artifact from 4 to 7

## v0.2.4 - 2026-03-02

- 30bff87 Merge pull request #143 from thetigeregg/dependabot/npm_and_yarn/server/types/pg-8.18.0
- bc56385 Merge branch 'main' into dependabot/npm_and_yarn/server/types/pg-8.18.0
- ce33122 chore(deps): bump @types/pg from 8.16.0 to 8.18.0 in /server

## v0.2.5 - 2026-03-02

- e4103b4 Merge pull request #141 from thetigeregg/dependabot/npm_and_yarn/lint-staged-16.3.1
- c4938c0 Merge branch 'main' into dependabot/npm_and_yarn/lint-staged-16.3.1
- 7ca8879 chore(deps): add chokidar and readdirp as optional peer dependencies for @ionic/angular-toolkit
- c0cc942 Merge branch 'main' into dependabot/npm_and_yarn/lint-staged-16.3.1
- 9441f5e chore(deps): bump lint-staged from 16.2.7 to 16.3.1

## v0.2.6 - 2026-03-02

- 60fc333 Merge pull request #145 from thetigeregg/dependabot/docker/edge/caddy-2.11-alpine
- 4bb6f02 Merge branch 'main' into dependabot/docker/edge/caddy-2.11-alpine
- a87ac97 Merge branch 'main' into dependabot/docker/edge/caddy-2.11-alpine
- ac434c0 chore(docker): bump caddy from 2.10-alpine to 2.11-alpine in /edge

## v0.2.7 - 2026-03-02

- 6b1657d Merge pull request #147 from thetigeregg/codex/429-toast
- b406969 Fix rate-limit toast coloring
- 9a936dd Clarify rate limit toast handling
- 47967c4 Audit Metacritic rate handling

## v0.2.8 - 2026-03-02

- cb66cb0 Merge pull request #148 from thetigeregg/codex/mobygames-platform-alias
- fbf8f65 Merge branch 'main' into codex/mobygames-platform-alias
- e7fc888 Update aliased platform mappings
- 6c76f18 Add tests for IGDB platform aliases
- 30fa410 Merge branch 'main' into codex/mobygames-platform-alias
- 6cd8e60 Update platform alias lookups

## v1.0.1 - 2026-03-02

- 8b4a20d Merge pull request #149 from thetigeregg/codex/add-timeadjusted-score-metric
- 706f60e Reject zero hours in TAS score
- 5e95faa Check TAS zero-hour validation
- 529b174 Review TAS and time preference
- 27b4647 Reject zero hours in TAS calc
- 723948b Adjust TAS to reject zero-hour HLTB
- 54ddbdd Bump app version to 1.0.0
- ccd1682 Audit branch changes before PR
- 017f446 Merge branch 'main' into codex/add-timeadjusted-score-metric
- 8ce07a2 Adjust default time preference to 15
- 3ab5d2e Update time preference help text styling and alignment
- 1198435 Update time preference input alignment in settings
- 51a9d88 Add TAS sorting mode
- 5a909bb Add TAS sorting option
- 3394470 Add TAS sort mode with config

## v1.0.2 - 2026-03-02

- f794f39 Merge pull request #150 from thetigeregg/codex/allow-halfstep-user-ratings
- e0b9762 Add Explore InRange coverage
- 934f934 Audit explore branch changes
- 3eb50ff Hide trailing zeros in ratings
- 890628a Allow half-step user ratings
- f03747e Allow half-step ratings
- 0e3cc63 Allow half step ratings
- 867619c Allow half-step user ratings
- ad392f0 Allow half-step ratings

## v1.0.3 - 2026-03-04

- fb306eb Merge pull request #151 from thetigeregg/codex/recommendations
- c0398e9 Align diversity penalty default
- 5af63af Align diversity penalty default
- a075658 Align diversity penalty default
- 503ec68 Align diversity penalty defaults
- 6e5219f Fix discovery detail parity
- 36f019d Fix discovery parity issues
- 1fef5b2 Fix discovery parity issues
- 9991c28 Fix game similarity target updates
- 942f797 Add segment switch for similar games
- d19abee Trim strings in parsePositiveInteger
- 3364f6d Add OpenAI embedding safeguards
- 73d4a0c Add timeout validation to embeddings
- 42785c3 Add embedding timeout handling
- d16177e Fix similarity runtime scope
- 8feb5c2 Fix similarity shared tokens overlap
- 617e618 Investigate similarity boost impact
- 0bf36b0 Ensure similar game click scrolls to
- 9433365 Enhance styling for SimilarGameRowBadge component
- b2b6f64 Add rationale split test
- 425fac5 Assess Copilot feedback on logs
- 43690b3 Simplify normalizeCriticScore logic
- 55e4274 Simplify critic score normalization
- 013a73b Document detail shortcut fab actions
- bb67775 Review embedding dimension config
- 75dcd20 Investigate Copilot suggestions
- 8647ed9 Enforce strict rating parsing
- d90a34d Validate rating filter inputs
- 07223fe Validate rating filter parsing
- 815a8d9 Pin Postgres image reference
- b3496dc Harden positive id parsing
- 2fed92d Remove unused OpenAI dependency
- 03b9f6a Enforce minimum rate limit window
- a2b691d Avoid clearing metadata when missing
- 40c3332 Reject non-integer theme ids
- f29a1c5 Regenerate PR summary from main diff
- 927b359 Generate PR summary after diff
- e0b3972 Reevaluate metadata merge behavior
- 1dcd0e7 Reject truncated non-integer ids
- adb0753 Audit branch and apply fixes
- a3116c8 Audit branch and tune scroll
- 668191d Reduce infinite scroll threshold for recommendations and similar games
- 98ea4de Add infinite scroll to related games
- 027fd1f Reuse discovery similar games
- d5ae3f8 Remove frontend similar filter
- e63529b Prevent duplicate similar games
- 175b2ab Fix discovery game detail issues
- a274973 Split recommendation headline lines
- efef170 Update similar row badge display
- df80bec Add back navigation button
- ea8a22b Unify related games layout
- 865a72b Restore old header template
- 7d18c3b Fix discovery game detail FAB
- 4d60e50 Investigate discovery detail regress
- 721156c Merge discovery queue duplicates
- 1fc19f3 Merge duplicate discovery games
- 32481ce Fix discovery frontend display
- 2826833 Add discovery lane configs
- 676234e Add config for discovery refresh
- d883601 Add recommendation env vars
- 35abe5e Allow popular and recent lanes
- 0023d44 Explain discovery cache behavior
- 1872cf5 Filter discovery recent game query
- 9469b4e Avoid deprecated IGDB fields
- 35e7086 Enable recommendation enrichment
- 25ffd91 Clarify IGDB recommendation scope
- 66608f3 Bold scores and split rationale
- 6536c69 Bold score values in explore
- b785206 Update recommendation rationale
- 5862f54 Align explore game rows
- f309abe Fix explore game row layout
- 7a366e0 Align explore game row layout
- 0700688 Adjust explore game row layout
- ca0d4f7 Add themes and keywords to recs
- c142145 Add theme keyword explainability
- 13b3f14 Fix rating filter half steps
- d744256 Add IGDB themes keywords metadata
- 24fc86c Ingest IGDB themes and keywords
- dea8526 Add icons for selection options in Explore recommendations
- 9e46237 Refresh Discover UI and audit rates
- 128ee22 Update explore recommendations UI
- cf3c746 Implement Explore recommendation MVP
- a14220c Implement Explore UX recommendations
- 3273dd5 Implement explore recommendations UX
- f6d73ac Implement Explore-first rec UX
- 6857046 Audit recommendation factor weights
- f0e5820 Clear games table and verify boost
- ecc08df Filter recs by status and normalize
- 498a7a1 Add status filtering to similar recs
- 20ecaa8 Add runtimeMode recommendations
- bccc360 Add peer dependency flag to multiple packages in package-lock.json
- 913aeb0 Add runtime mode materialization
- a54ea10 Add runtimeMode materialization
- e2a9e6f Implement semantic recommendation up
- f6f5ba6 Implement v1 recommendation API
- ba05508 Implement recommendation API

## v1.0.4 - 2026-03-04

- 3a03b16 Merge pull request #152 from thetigeregg/codex/enable-worktreefriendly-dev-env
- 30da5ac Ensure pulled sync failures rollback
- cdeca6a Adjust write-token interceptor base
- 4cd5e3d Treat empty gameApiBaseUrl as API
- c3f0c80 Handle empty base URL for API
- b48fb37 Update worktree-dev status logging
- 60c29d7 Audit final regression changes
- e1ad008 Audit branch changes vs main
- 74771b4 Update docs for worktree dev stack
- 4112865 Fix frontend game loading
- 8b205c7 Fix DB seed vector extension
- c13a746 Merge branch 'main' into codex/enable-worktreefriendly-dev-env
- c3b2158 Fix db seed apply missing root role
- deab81f Fix backend port offset not applied
- f077386 Fix sync pull returning 404
- e5e4037 Fix worktree API port
- a8f0f5e Add worktree bootstrap flow
- 0cf6624 Document shared env workflow
- aef78a7 Document worktree DB seed commands
- 3d8452e Document worktree-safe dev commands

## v1.0.5 - 2026-03-04

- 383b255 Merge pull request #153 from thetigeregg/codex/chore-remove-tracked-nas-secrets
- 7671149 Merge branch 'main' into codex/chore-remove-tracked-nas-secrets
- 0ffd929 chore(secrets): stop tracking nas secret files

## v1.0.6 - 2026-03-04

- 02c915e Merge pull request #154 from thetigeregg/codex/fixy
- 9b55e16 Summarize Caddyfile proxy fix

## v1.0.7 - 2026-03-05

- 2930b05 Merge pull request #157 from thetigeregg/codex/fixy
- c027646 Clamp enrichment maxAttempts
- 203f88c Align HLTB zero handling
- 63cbef1 Handle zero HLTB hours
- 22b0b08 Prevent skipping zero HLTB rows
- 1f223d4 Align HLTB enrichment logic
- 7ce4482 Add permanentMiss backoff tests
- 994f542 Fix HLTB detection logic
- 6e0e82b Include all HLTB fields check
- c4699a4 Write PR summary from diff
- 71785d5 Summarize diff against origin main
- 72ac81d Update HLTB presence check
- 6c23ff2 Merge branch 'main' into codex/fixy
- 9d19e5e Add discovery enrich backoff limits

## v1.1.0 - 2026-03-05

- 90be8e2 Merge pull request #160 from thetigeregg/bump
- 3b7b7c2 feat: add audit fix command for all dependencies
- 209f3c4 Run audit fix

## v1.1.1 - 2026-03-05

- a93935b Merge pull request #161 from thetigeregg/codex/screenshots-videos
- fefe3f8 Trim options size before use
- 9a1dde5 Allow explicit nulls in sync upsert
- b5f3a3e Allow null clears in sync
- ced03a2 Improve patch coverage and lint
- 5085be6 Guard game payload update
- c682957 Add payload equality guard
- f43d8b2 Prevent metadata payload churn
- b221764 Add deep equality payload check
- 04e53a7 Fix failing unit tests and run suite
- 347e845 Audit prod allowlist effects
- 925c53a Review manual override video UI
- ff3efe6 Reorder manual action buttons
- 75cd6e2 Reorder shortcuts and move manual
- cba5986 Add videos button and modal
- 024ce98 Add videos modal fab shortcut
- c059295 Enable swiper coverflow and lazy
- 5e007f5 Add Swiper lazy loading preloader
- 68da668 Adjust swiper pagination spacing
- d4c546d Fix pagination spacing logic
- 32ccb42 Update swiper params
- 1c1dbe3 Update swiper navigation icons
- 5a289fd Fix detail-cover padding
- 9782b76 Add Swiper carousel to detail
- afcb10c Add swiper dependency to package.json and package-lock.json
- 689b5f8 Fix worktree seeding sync history
- d9d0683 Format generated platform artifacts
- 458a66c Merge branch 'main' into codex/screenshots-videos
- 4649ab7 Update repository sync tests
- 2f6b905 Add IGDB screenshot enrichment
- a6e4817 Merge branch 'main' into codex/screenshots-videos
- 5809577 Add support for screenshots and videos in metadata enrichment

## v1.1.2 - 2026-03-05

- 545981c Merge pull request #162 from thetigeregg/codex/screenshots-videos
- 77555c0 Investigate ui test proxy errors
- ce03b04 Rename upload step for raw coverage artifacts in CI workflow
- e07ac5b Summarize igdb media fix
- 77033e5 Merge branch 'main' into codex/screenshots-videos
- 904a31f Update media normalization dedupe

## v1.1.3 - 2026-03-05

- 07b43e3 Merge pull request #163 from thetigeregg/codex/pollution-fix
- 78dcd26 Optimize game outbox filtering
- 8b3b224 Optimize pending game checks
- 2a935e6 Optimize game outbox lookup
- 5ecb610 Fix HLTB discovery retry handling
- 9442cbb Add shim to post-checkout hook
- 7722f4d Ensure post-checkout hook runs
- 6b3e84e Review discovery sync safeguards
- c4919b8 Audit discovery cleanup logic
- cec30c2 Await remediation before sync
- 9521bbf Await remediation before sync
- 205e411 Preserve collection games on sync
- 0b58de7 Prevent discovery record deletion
- 8d598c2 Use canonical timestamp in test
- a4c5ee8 Add flag check to husky post-check
- 975c109 Delete local game on discovery upser
- 761f0b1 Clarify pushOutbox cursor behavior
- 79af92a Provide live cleanup command
- 89d586a Investigate missing discovery finger
- 69c0757 Count game discovery fingerprints

## v1.1.4 - 2026-03-05

- a286458 Merge pull request #166 from thetigeregg/codex/fixr
- 96cdd6d Merge branch 'main' into codex/fixr
- 406876e Update dompurify to 3.3.2

## v1.1.5 - 2026-03-05

- 50793da Force push
- 2707002 Merge pull request #169 from thetigeregg/codex/discovery-excludes-owned-game
- 7c7166d Force push
- f274937 Merge branch 'dependabot/npm_and_yarn/server/fastify-5.8.1' into codex/discovery-excludes-owned-game
- c033936 Update discovery filter by game id
- a0c83fc Force push
- cb89b1e chore(deps): bump fastify from 5.7.4 to 5.8.1 in /server

## v1.1.6 - 2026-03-06

- a7a5b05 Force push

## v1.1.7 - 2026-03-06

- 781b17a Merge pull request #170 from thetigeregg/codex/discovery-game-retry-limit
- f80d8ac Update package lock
- f833119 Fix discovery query for Project Gorg

## v1.1.8 - 2026-03-06

- dbafaec Merge pull request #171 from thetigeregg/codex/discovery-game-retry-limit
- d85194a Reuse config helpers for discovery
- a785be1 Refactor discovery config helpers
- 3d7b50a Centralize discovery enrich env
- f934424 Type discovery enrichment options
- 89426e5 Add rearm fields to discovery opts
- 043560a Add rearm options to discovery types
- 918452f Adjust DiscoveryEnrichment imports
- a3ce241 Fix discovery enrichment date logic
- 63523f1 Fix transient retry state handling
- 5a7c554 Add coverage for repository.ts
- 7c31b7b Add repository coverage option2
- da84b58 Force push
- 4ca7239 Explain codecov coverage failure
- 2d8ccf2 Explain codecov patch coverage
- 527e29f Explain codecov and regen summary
- 2bd3762 Merge branch 'main' into codex/discovery-game-retry-limit
- 762bb2f Add rearm logic for HLTB

## v1.1.9 - 2026-03-06

- 1659584 Merge pull request #172 from thetigeregg/codex/convert-game-rating-modal-to
- fcb1c8c Convert rating modal to sheets
- 2ce1fe4 Convert game rating modal to sheet
- ffc1760 Convert rating modal to sheet

## v1.1.10 - 2026-03-06

- debc485 Merge pull request #174 from thetigeregg/dependabot/npm_and_yarn/server/express-rate-limit-8.2.2
- 10906f5 chore(deps): bump express-rate-limit from 8.2.1 to 8.2.2 in /server

## v1.1.11 - 2026-03-07

- b951892 Merge pull request #173 from thetigeregg/fcm
- bd01423 Refactor alert enable handler
- 9578077 Document notification routing incons
- e9cba5e Align import notification toggle
- 404366c Ensure app close on startup failure
- 6616db4 Allow zero HLTB hours in payload
- 6211bd1 Avoid duplicate notification upserts
- 1ca1e21 Fix notification registration type
- 5e74955 Defer release notification flag
- eaa74a8 Document refresh delay for new games
- dad0605 Guard notification on worker ready
- 11cab9c Fix firebase SW fallback version
- 657293d Restrict release eligibility to past
- 3d4f82e Sequence version notification alerts
- b256c62 Document notification sync ordering
- 1748045 Confirm advisory lock duration
- abb19b4 Simplify boolean normalization
- ba9baa6 Add rollback for release toggle
- 5bfe4ff Retain metacritic zero values
- f85bec5 Add runtime firebase CDN version
- bc82c88 Remove redundant FCM init guard
- 8ff5d63 Fix hasHltbValues zero detection
- 9b4a0a5 Turn off release notifications on im
- 20caec3 Add release event import test
- e5e7282 Sync SW Firebase CDN version
- ed08ec6 Fix release event import order
- 2d7bf47 Fix Metacritic score detection
- 8558d07 Handle release monitor shutdown
- 5d66e1c Fix release monitor shutdown
- 7c45ca4 Fix release docs and monitor
- b66db7f Limit notifications test tokens
- 7206657 Fix metacritic float detection
- 1c7dc31 Add resetFcmState helper
- da9af65 Restrict notification admin auth to
- 1c3a154 Prevent review overwrite
- febddc5 Fix release notification storage
- 898316c Validate month precision markers
- db5ff05 Add month range validation
- 4464e1f Log IGDB refresh null failures
- c25f69e Fix release notification toggle fire
- d7133ea Fix release notification sync flow
- d5d5c36 Cache Firebase messaging instance
- 0d87b66 Limit token length and guard init
- b9c5891 Handle withGameLock errors per game
- 1099580 Return notification promise
- 87dd5b1 Return notification promise in SW
- 588117d Use floats for Metacritic scores
- 0b8f251 Use numberOrNull for reviewScore
- b2d92a9 Use numberOrNull for Metacritic
- eb38593 Fix ReleaseMonitor promise returns
- 48c78d4 Fix Angular routing for foreground
- 8cd979e Fix notification init routing
- 0865465 Clarify release notification toggle
- 38b3fb4 Merge branch 'main' into fcm
- 81e3069 Document release day deduplication
- 9d0fe27 Simplify release monitor success
- 4b74562 Fix release workflow heredoc
- dbdd37c Fix environment prod heredoc indent
- 9e2ae54 Fix release workflow heredoc
- 34aedeb Wrap ReleaseMonitorFlowClientMock in
- bdd44ea Add auth header to observability c
- 8b19dd5 Add auth header to notifications doc
- b3ebf83 Prevent HLTB Metacritic timestamps
- 1425bc9 Preserve release precision data
- c0858a1 Document optional notifications test
- 137c042 Fix release notification preference
- 48b47ca Document token load limits
- 4781165 Disable release event toggles
- dbcb497 Preserve handler error on unlock
- 30fc92e Prevent race when initializing FCM
- b6bb802 Handle release monitor DB failure
- 6f530d9 Handle release-monitor upsert errors
- cc76411 Handle release monitor fallback
- 5a81f87 Handle release-monitor query errors
- f8a8351 Fix release monitor error recovery
- 72039ac Harden notification prefs parsing
- 2de1aa7 Clarify upgrade columns comment
- 90ac4ab Store firebase config in file
- b48b295 Add auth guard to notification test
- 271fd9c Batch FCM token retrieval
- 7a60b42 Encapsulate release monitor state
- eb29f52 Fix release monitor token handling
- 0ba7df9 Fix Firebase init flag handling
- 0b07de7 Correct lastIgdbRefreshAt typo
- 601ec57 Fix release workflow heredoc
- 94d680b Add featureFlags to prod env gen
- e886f0e Limit production Firebase env step
- 467ea51 Remove redundant nextEnabled check
- 438b578 Fix notification appVersion field
- f414bb4 Fix notification preference scope
- 75c971b Fix notification preferences scoping
- 8c5b8a1 Fix notification service appVersion
- f0f4347 Add metacritic refresh vars
- 66dae34 Review recent server config updates
- 6b21641 Add FCM token cleanup env
- b1ee911 Add runtime Firebase config flags
- 9e6ab25 Audit release monitor implementation
- ace69bf Audit PWA notifications flow
- f416595 Review IGDB game response log
- aa37747 Investigate missing release log
- 6ee2939 Clarify Firebase secrets setup
- 17303b0 Add recreate worktree stack script
- cfbe464 Locate duplicated Fastify routes
- 91411e7 Fix duplicate hltb route
- 9261ef0 Review branch alignment with Fire
- 0c6d79d Document release notification info
- 7af7f67 Validate merged branch changes
- 5ac68b6 Merge branch 'main' into fcm
- f8d8b8a chore: update dependencies and version for game-shelf and game-shelf-server
- 9e2580b chore(package): add overrides for Angular Fire dependencies
- f42fc28 Merge branch 'main' into fcm
- a2c8131 Merge branch 'main' into fcm
- 7f5ec07 Merge branch 'main' into fcm
- b688e8a Validate merge for regressions
- 063a242 Merge branch 'main' into fcm
- c81f9a3 Investigate stopped service worker
- 55b7126 Fix release notification service
- 78b3749 Prompt for release notifications
- 40e8161 Add CI production env writer
- 2ef5c0c Add Firebase local env config
- 776f369 Clarify Firebase setup and refresh
- 334aa00 Explain release monitor refresh flow
- 81a7be3 Add monitoring env vars
- c3af4c9 Implement game monitoring service
- 8dc97c6 Implement monitoring for new games
- 40b7c87 Brainstorm new-game data updates

## v1.1.12 - 2026-03-07

- aeea264 Merge pull request #177 from thetigeregg/fix
- d5bbc65 Update dependencies
- 1192442 Update packages
- cc09b60 Fix audit issues

## v1.1.13 - 2026-03-08

- 4fb846a Merge pull request #178 from thetigeregg/fix
- 3f95c13 Document background worker env vars
- 220f667 Fix drift integration test assertion
- a5ee464 Add Postgres drift CI service
- c271114 Fix recommendations primary key
- 8091a0f Fix duplicate primary key migration
- 501dca0 Fix worker dev flow updates
- ad486b1 Update dev worktree stack docs
- 60a914a Add background worker to dev flow
- 1e9d2f7 Handle queued recommendation status
- 1afc291 Reset job attempts on replay
- dde96f1 Reset job attempts on replay
- e3978f1 Fix job replay attempts reset
- 812860e Fix finished_at for failed jobs
- 9299fd1 Fix recommendation rebuild enqueue
- f7e6bb7 Add comments to background job queue
- ddab921 Document portainer env secrets
- 935eabb Fix manual catalog snapshot
- 5d1ec67 Address PR note for recommendations
- bc0cd88 Restrict background job stats query
- 4cefb27 Add graceful shutdown handling
- 8ada4cf Return fallback jobId on enqueue
- 0d0174a Include fallback jobId in queue
- 2fa38ad Comment docker compose env vars
- 2c25ee3 Audit claimRecommendationRebuildJob
- d9e6bcc Increase coverage for background job
- 9e949b7 Improve recommendation job coverage
- 36d8455 Improve recommendation rebuild job
- b042c63 Generate PR summary using template
- c1faf7c Merge branch 'main' into fix
- de7f643 Document background job admin routes
- 07c864e Move job processing to queue
- 03bcc12 Add job concurrency config
- dae9020 Rework architecture for async jobs
- b3f3a81 Add background job architecture for
- 36a4645 Offload recommendations CPU work

## v1.1.14 - 2026-03-08

- 7a4039b Merge pull request #179 from thetigeregg/codex/investigate-production-issue
- e121c03 Fix migration test and pool cleanup
- 3b2fc94 Export MigrationUnlockError
- cf74a3b Export MigrationUnlockError
- 740f29d Treat migration unlock failures as …
- 547e089 Add migration lock ordering check
- 246e0d7 Escape advisory lock identifier
- 54d6595 Harden migration locking
- b66e3bf Define migration lock constants
- 0bcb72b Define migration lock keys
- 17b63c5 Add migration lock constants and ref
- 672dd13 Define migration lock constants
- 6a92d05 Fix prod peer flag removals

## v1.1.15 - 2026-03-08

- 82d49cb Merge pull request #180 from thetigeregg/codex/investigate-production-issue
- 99cfca7 Align background worker payload keys
- 01fb083 Log request raw url and route
- 7a1d9ec Clarify release monitor SQL log
- ba9fa02 Fix release monitor log text
- 4be59fc Update release monitor logs
- 907dbe5 Align release monitor SQL string
- 15001c7 Update release monitor SQL note
- af20d06 Merge branch 'main' into codex/investigate-production-issue
- 5876768 Add background job logging
- 2c1fc5c Add background worker lifecycle logs

## v1.1.16 - 2026-03-08

- f9789dc Merge pull request #181 from thetigeregg/codex/add-prod-observability-endpoints
- b8fc6c9 Adjust Postman manual tests
- ace8323 Merge branch 'main' into codex/add-prod-observability-endpoints
- 15bfba9 Allow 429 in Postman status tests
- 715161a Allow blank failedBefore default
- dc03c0b Update failedBefore handling
- a128bb1 Audit Postman collection names
- 5893685 Document postman prod ops collection
- cd2ecf5 Add prod observability Postman
- 9706623 Add prod observability Postman

## v1.1.17 - 2026-03-08

- 4638de7 Merge pull request #182 from thetigeregg/codex/perfs
- 758de21 Add finalizeRunSuccess batch test
- 9d4a801 Add tests for finalizeRunSuccess
- ac88ba2 Fix loops in finalizeRunSuccess
- 0928f50 Fix mode fallback dedupe
- d7493e9 Implement deterministic fallback
- 8a9c799 Fix recommendation fallback query
- 122a410 Fix runtime mode fallback logic
- f8864c9 Summarize recent request log

## v1.1.18 - 2026-03-09

- 689e35a Merge pull request #183 from thetigeregg/codex/perfs
- 34cdc1c Investigate coverage drop
- 07f1301 Clarify background job test name
- 3d3aa8d Fix background job heartbeat naming
- 62b10e6 Update background jobs heartbeat env
- f71d4e6 Update docs for BACKGROUND_JOBS lock
- 9163999 Document new background env vars
- 3093c48 Clarify background worker logs
- b057769 Add background job tests and docs
- 8cb7eda Generate PR summary and update docs
- 97e2c25 Merge branch 'main' into codex/perfs
- b242f92 Check running background job status

## v1.1.19 - 2026-03-09

- 38453f8 Merge pull request #188 from thetigeregg/dependabot/github_actions/docker/login-action-4
- ecab595 Merge branch 'main' into dependabot/github_actions/docker/login-action-4
- 3d315e6 chore(ci): bump docker/login-action from 3 to 4

## v1.1.20 - 2026-03-09

- 2e6207b Merge pull request #191 from thetigeregg/dependabot/github_actions/docker/setup-buildx-action-4
- 6a1ddaa Merge branch 'main' into dependabot/github_actions/docker/setup-buildx-action-4
- 598ef40 Merge branch 'main' into dependabot/github_actions/docker/setup-buildx-action-4
- c9cba20 chore(ci): bump docker/setup-buildx-action from 3 to 4

## v1.1.21 - 2026-03-09

- fdf04f2 Merge pull request #190 from thetigeregg/dependabot/github_actions/docker/build-push-action-7
- 27ad35b chore(ci): bump docker/build-push-action from 6 to 7

## v1.1.22 - 2026-03-09

- 9f10f06 Merge pull request #189 from thetigeregg/dependabot/github_actions/docker/metadata-action-6
- 8047baa Merge branch 'main' into dependabot/github_actions/docker/metadata-action-6
- e8068ab chore(ci): bump docker/metadata-action from 5 to 6

## v1.1.23 - 2026-03-09

- cfe6710 Merge pull request #192 from thetigeregg/bump
- 008d7bb chore: update @eslint/js to version 9.39.4 and add @angular/forms dependency
- 742450e Merge branch 'main' into bump
- cdf1d45 Revert "chore: update firebase dependency to version 12.10.0"
- 023b76b chore: update firebase dependency to version 12.10.0

## v1.1.24 - 2026-03-09

- 7a43e39 Merge pull request #193 from thetigeregg/codex/scoring
- ba37ae2 Remove IGDB review scores
- 8138e11 Remove IGDB review scores

## v1.1.25 - 2026-03-09

- be3f7d2 Merge pull request #194 from thetigeregg/codex/wroerk
- 2ae8acc Address note
- 6681e67 Address note
- 158dd6f Address notes
- 87d8746 Address notes
- 433d740 Merge branch 'main' into codex/wroerk
- d8ae288 refactor(worker): split background worker into general and recommendations roles

## v1.1.26 - 2026-03-09

- c2422f0 Merge pull request #195 from thetigeregg/codex/ignore-recs
- 8d54d1a Update Similar Discovery empty state
- 4df1615 Use RecommendationIgnoredEntry type
- a145e34 Validate recommendation payload
- 7855b41 Fix lane empty state messaging
- 34002cb Fix NVM fallback handling
- 321a9c2 Cache filtered similar discovery
- afadddb Cache visible recommendation lists
- e3acf5d Ensure nvm install runs via bash
- ac089c2 Address ignored recommendation notes
- 8773213 Audit explore page updates
- b011e60 Add discover header menu
- 4aff55f Add ignore alert and toolbar polish
- b8e0db1 Adjust discovery queue filters
- 4d1cf12 Add toolbar buttons for game actions
- 4732aa6 Fix recommendation ignore init error
- ebe2684 Fix worktree bootstrap script error
- 731f352 Fix worktree bootstrap script error
- 795331c Fix nvm bootstrap script syntax
- 5969345 Run nvm use before worktree install
- 5a5be62 Ensure nvm use before npm install
- 3210e0e Add ignore button to discovery

## v1.1.27 - 2026-03-09

- 23d7067 Merge pull request #196 from thetigeregg/codex/document-worktree-creation-hooks
- dfa1bd8 Update .husky/post-checkout
- 4777931 Verify new worktree hooks

## v1.1.28 - 2026-03-10

- a7b9731 Merge pull request #197 from thetigeregg/codex/investigate-bulk-move-freeze
- b3bb10c Simplify view creation transaction
- 22050d4 Return created tag from transaction
- 295113f Use trimmed timestamp in outbox
- c7e6d8a Fix requestSyncNow typing
- f3a8b84 Restore immediate sync after outbox
- 9e22920 Add batched game tag/status specs
- 5c8ae46 Refresh list after partial updates
- 4d69fae Investigate bulk wishlist sync
- 46edc72 Investigate bulk wishlist freeze

## v1.1.29 - 2026-03-11

- 1fcf2bc Merge pull request #198 from thetigeregg/codex/itad
- 05eec8c Restore storage spy after test
- d015d40 Restore Notification global
- b120a10 Avoid resetting priceFetchedAt
- e9f59ff Update runtime-config feature flags
- 03388e4 Track incoming steamAppId flag
- 5506983 Handle currency formatter errors
- 7e5da9c Handle currency errors in formatting
- 303789c Serialize discovery pricing hydrate
- 71eccde Improve detail media lazy loading
- db81d3d Preserve pricing fields in sync
- 822a316 Fix discovery price currency
- 388b1b9 Fix discovery currency formatting
- 1115e6f Resolve browserslist and budget warn
- aa69b21 Resolve browserlist warning
- 168fe77 Fix browserslist warning
- ad64502 Review discovery recommendation SQL
- 66b7705 Inspect discovery metrics
- c73c0c3 Rethink wishlist row layout
- e325814 Refactor wishlist row layout
- 21a5bfa Add pricing display to discovery and
- 8c85070 Display discovery pricing info
- 3e58cf2 Add PSPrices cache override test
- 8f977f1 Audit PS prices route handling
- 289bd83 Plan discovery pricing refresh
- 63c317e Implement discovery wishlist plan
- b471bf6 Add pricing info to wishlist
- f0d8db7 Add wishlist pricing display
- 70f9807 Update pricing refresh configuration
- d7eb30b Adjust edition scoring weights
- 901c786 Treat standard edition neutrally
- ee66cd2 Update metadata validator UI
- 46837d1 Update metadata validator UI
- 884453b Update validator layout and labels
- 20fa2a3 Update metadata validator UI
- b6d9828 Fix validator filters and toggles
- e75f8e7 Fix settings notification toggles
- d7f8a02 Fix settings layout and bulk toast
- 06ac49e Fix bulk refresh feedback
- 1687a38 Fix pricing visibility and alerts
- b7e6160 Update multi-select metadata alert
- d5d73ff Restore metadata refresh alerts
- c8ad7de Fix Customize modal ordering
- 589846f Update wishlist sort and labels
- 29efabb Add wishlist pricing sorting
- b4a342a Add detailed pricing display
- 3c98e8e Update game row price styling
- 8f16b8a Investigate psprices cache hit issue
- b1b01dc Investigate psprices cache bug
- 3909871 Gate TAS pricing feature flag
- 47d5bde Add external metadata modal
- df9cad6 Refactor game metadata overflow
- 3577833 Move external metadata controls
- d2261da Limit pricing refresh to wishlist
- c067986 Merge branch 'main' into codex/itad
- 1724cba Remove price cache TTL vars
- d1dbfa3 Document parity gaps after update
- e8aec23 Document pricing cache telemetry
- f46a661 Validate new container builds
- 95a711b Align CI docs with new container
- fda3656 Update pricing parity workflow
- 0a585dc Add psprices scraper integration
- f5ab982 Stop lazy loading game images
- 588e338 Fix pricing fetch when adding game
- 9bc7f26 Add Steam price data fetch
- f45e8bf Pull steam ids when adding games
- 10d2802 Switch to steam pricing only flow
- 70ef440 Switch price query to EUR
- 6eda59a Normalize bestPrice regularAmount
- 6b56b76 Analyze ITAD price response
- 35e31ac Persist Steam wishlist enrichment
- d0974a8 Fix metadata enrichment query
- c90cd48 Implement Steam ITAD pricing
- ebcdacf Add Windows ITAD pricing enrichment

## v1.1.30 - 2026-03-11

- 21d519f Merge pull request #200 from thetigeregg/codex/fix-edge-docker-build-failure
- 5515652 Extract shared prod env writer
- f2c700b Add edge Firebase env write step

## v1.1.31 - 2026-03-11

- 904f5f6 Merge pull request #201 from thetigeregg/codex/add-helper-to-sync-env
- 5bc6fc7 Preserve env example comments
- 5d7438f Handle commented env keys
- 96891ba Allow empty env input value
- 544ca9a Revise env script prompt
- 5758803 Improve reconcile env handling
- 9f63faf Merge branch 'main' into codex/add-helper-to-sync-env
- 6d67a54 Rename dev:worktree scripts
- f41d3fc Automate worktree env rewrite
- 49a23dd Update reconcile worktree env script
- 0948a4c Add env reconciliation helper
- 32782a9 Add worktree env reconciliation

## v1.1.32 - 2026-03-12

- ec72fd4 Merge pull request #203 from thetigeregg/codex/pricing
- 72d63b0 Fix
- 79a568b Fix package misalignment
- a7e1e1b Update staleness logic for pricing

## v1.1.33 - 2026-03-12

- 5983d67 Merge pull request #204 from thetigeregg/codex/recommend-env-vars-for-pricing
- f30aaf1 Clarify bootstrap env handling
- da1c818 Add bootstrap env warnings
- 3b1ecb6 Handle missing shared env template
- c6ac8c6 Merge branch 'main' into codex/recommend-env-vars-for-pricing
- cac2b66 Add tests for pricing freshness and enhance price validation logic

## v1.1.34 - 2026-03-12

- 98d3fa2 Merge pull request #205 from thetigeregg/codex/verify-wishlist-pricing-via-docker
- 63ad8f7 Adjust sync cursor typing
- 4412e10 Add outbox recheck before replay
- 2b1ffff Record recent replay retry time
- 8df3849 Avoid extra sync cursor query
- 3dc2855 Fix sync cursor parsing and query
- 3966e3a Add tests for replayRecentChangesIf
- b969cb7 Explain sync pull cursor issues

## v1.1.35 - 2026-03-12

- fb436b4 Merge pull request #207 from thetigeregg/codex/enable-dependabot-for-github-actions
- f982e8b Add Node24 force env to workflows

## v1.1.36 - 2026-03-12

- 544351b Merge pull request #208 from thetigeregg/codex/confirm-pricing-choice-persistence
- 32dd5b0 Adjust PsPrices URL override
- 4c2110b Rename finiteNumber helper
- 10ed56f Centralize helper and cover sync n/a
- a72dba2 Address Copilot PR review notes
- 8131070 Preserve PSPrices title source
- d622fad Keep Mobygames override fallback
- 35da2bc Increase codecov patch coverage
- 66152c2 Rename review refresh counters
- 508c188 Track skipped psprices revalidation
- c385a55 Limit refresh when provider locked
- 0c0cddb Audit release monitor refresh locks
- e2e676c Merge branch 'main' into codex/confirm-pricing-choice-persistence
- a5d6e4d Add manual override lock checks
- 6bed28c Persist PSPrices provider identifier
- 8079f6e Persist custom override settings

## v1.1.37 - 2026-03-12

- 92f5596 Merge pull request #206 from thetigeregg/codex/add-wishlist-sale-notification
- b12607e Refine tie logic for high confidence
- d730efc Coerce sale preference strings
- 723f282 Coerce release event prefs
- 9132f35 Fix notification reservation leak
- ebd3768 Clarify active token cap warning
- a8d5862 Align sale discount percent payload
- ac63d60 Adjust PR summary and sale flags
- 25b5e42 Hoist roman symbol constant
- 978dd5d Make token cleanup best effort
- 887a18d Update PSPrices matcher plan
- a05026c Update PSPrices suffix ranking
- c61ad02 Clarify Diablo IV scoring rules
- 4acb2ab Prevent reservation release after DB
- f14b65c Prevent releasing log reservation
- 77acc49 Adjust reservation retention logic
- cb3699a Add notification stubs to tests
- 9523dfa Fix notification invalid token deact
- ba8e71f Log active token cap hits
- 7281741 Add warning when token load is full
- 8e41ecd Resolve merge conflict and test
- 13d0e06 Merge branch 'main' into codex/add-wishlist-sale-notification
- 1372050 Merge branch 'main' into codex/add-wishlist-sale-notification
- ea07e47 Wrap wishlist notification send
- 3d1a01c Add validation for parser scores
- 3cb52b1 Merge branch 'main' into codex/add-wishlist-sale-notification
- 7cc27bc Add wishlist sale notification

## v1.1.38 - 2026-03-13

- e732142 Merge pull request #209 from thetigeregg/codex/adjust-dark-pricing-color-contrast
- e573acd Add contrast tokens to dark palette
- 133a202 Restore button state and remove logs
- 402321d Investigate game shelf issues
- 92b1797 Fix dark ionic pricing contrast

## v1.1.39 - 2026-03-13

- b027e75 Merge pull request #210 from thetigeregg/codex/add-psprices-result-images
- be18bfa Add PR diff summary
- c5d0e7e Allow caching candidate-only hits
- 913ceaa Normalize HLTB image URLs
- c3f0891 Restore picker image behavior
- 35507de Fix ion header search toolbar
- 9467d5f Fix picker header buttons
- af42434 Fix picker toolbar search layout
- 5ce7fc6 Add placeholder and row padding
- d7f42f7 Fix missing placeholder images
- 712cfb1 Merge branch 'main' into codex/add-psprices-result-images
- 7e221d1 Fix psprices image selector
- 13c3743 Add psprices image scraping
- cb31554 Add psprices image handling

## v1.1.40 - 2026-03-13

- 59faa97 Merge pull request #211 from thetigeregg/codex/verify-die-breaker-logic-on
- 661b7ab Address coverage and review note
- ce1b2a4 Fix recommended candidate logic
- d9d88ce Fix browserslist warning after merge
- 7d34127 Merge branch 'main' into codex/verify-die-breaker-logic-on
- dff8fa9 Align PR title with manual match候选
- c6866c0 Merge branch 'main' into codex/verify-die-breaker-logic-on
- a898cc3 Highlight recommended search matches
- 3d95fd6 Highlight backend recommended match

## v1.2.0 - 2026-03-13

- af9cc8d Merge pull request #213 from thetigeregg/cursor
- 506095e chore(copilot): remove pre-push validation requirements from instructions
- 7a58d60 Potential fix for pull request finding
- 47d72a7 chore(workflow): remove husky pre-push validation hook
- 6288535 fix(workflow): harden monorepo excludes and make editor launch non-fatal
- 0f5f876 fix(worktree): require clean repo and fail when bootstrap fails
- 768b4fe chore(workflow): update pre-push reminder script name
- cc19523 feat(worktree): automate task-start branch setup and bootstrap flow
- a800a94 chore(workflow): remove redundant pr:summary npm script
- d088dae fix(workflow): harden hooks and git diff command handling
- ea73eae chore(workflow): remove Cursor-specific setup and align editor launch wording
- d332410 fix(workflow): fail fast pre-push checks and harden worktree task validation
- 55c1f04 chore(gitignore): exclude generated pr summary prompt
- e53d5be chore(scripts): support nested task worktree paths
- a71bead chore(scripts): make task worktree opener cross-platform
- edacd8f chore(scripts): harden task worktree helper
- 4a19f91 fix: enhance error handling in command execution for pr-summary script
- afa2456 chore: add worktrees directory to .gitignore
- 92e01d2 chore: update task start script and enhance post-checkout hook for worktree management
- 915107b chore: simplify pre-commit hook by removing redundant lint and test commands
- d65921e chore: update commitlint configuration and add pre-push validation requirements

## v1.2.1 - 2026-03-13

- 689c8ec1 Merge pull request #215 from thetigeregg/feat/chore
- b7a1a3aa chore(scripts): use force delete for auto-cleanup branch removal
- 5ed78c83 chore(scripts): harden current worktree detection in dev-cleanup
- f16221f4 chore(scripts): harden dev-cleanup worktree parsing and auto-skip safety
- 6d15954c chore(scripts): harden dev-cleanup branch discovery and git output handling
- 6234b58a chore: force push
- efee63c3 chore(scripts): harden dev-cleanup git command execution
- c9307ad9 chore(scripts): harden dev-cleanup git parsing and auto mode execution
- adac073e chore: add auto mode to dev cleanup script for enhanced functionality
- e1e2bddf chore: enhance dev cleanup script with auto mode and improved logging
- 1b566b84 chore: refactor dev cleanup script for improved clarity and functionality
- e5bc5e4b chore: add dev cleanup script to package.json
- 5e4e9d88 chore: add dev cleanup script for repository maintenance

## v1.2.2 - 2026-03-14

- 666bb4d3 Merge pull request #218 from thetigeregg/feat/bump
- 2e7b4999 fix(scripts): harden main worktree sync checks for task start
- 21010634 fix(scripts): handle checked-out main when fast-forwarding from origin/main
- bc771181 fix(scripts): fast-forward local main from origin/main before task worktree creation
- f9c21796 Revert "build(deps): bump frontend and server package dependencies"
- 6e079754 fix(scripts): create new worktree branch from local main
- 9791ac75 build(deps): bump frontend and server package dependencies

## v1.2.3 - 2026-03-14

- eb1a6c96 Merge pull request #212 from thetigeregg/codex/fixer
- 21514ecc fix: test
- 29de797f fix: test
- 110443df fix: test
- 80b14e10 Merge branch 'main' into codex/fixer
- 34b96f34 fix: tests
- ceda17a1 fix: update dedupe to respect URLs
- 5e28b019 fix: update review dedupe keys
- 9d1444e5 chore: fix
- 4402189a chore: test
- 17380a95 chore: updates
- 70c09367 Merge branch 'main' into codex/fixer
- 77b65d45 fix: prevent invalid HLTB item overwrite
- f054514b fix: test coverage
- e601fde8 chore: ensure preferredUrl passed to lookup
- 58ed6e1f Merge branch 'main' into codex/fixer
- 1f26da98 Capture HLTB values once
- 75bec13d Avoid redundant HLTB normalization
- 05c17a60 Merge branch 'main' into codex/fixer
- a7974249 Add HLTB exact match tracking
- b34efc55 Extract picker candidate title mixin
- 82bf97eb Mark fallback review recommended

## v1.2.4 - 2026-03-14

- 2ec6f3ec Merge pull request #219 from thetigeregg/feat/bumpz
- 7338b51f Merge branch 'main' into feat/bumpz
- 82b76a35 test(core): replace deprecated toThrowError matcher in specs
- 173adf41 chore(deps): bump Angular and tooling dependency versions

## v1.2.5 - 2026-03-14

- 3a8244d0 Merge pull request #220 from thetigeregg/feat/fix
- c653a47f fix(api): split jsonb_build_object to respect PostgreSQL 100-argument limit

## v1.3.0 - 2026-03-16

- 6f23ffab Merge pull request #231 from thetigeregg/feat/scripts
- a3438987 fix(scripts): make pr agent prompt cross-platform
- 51d7f7f7 fix(scripts): honor copilot-only filtering in pr agent
- 1edb3c28 fix(scripts): harden pr agent check and coverage handling
- 063b3e4f feat(scripts): update
- 0fc37ad8 feat(scripts): update prompt
- 5b246907 feat(scripts): address regressions
- 6950d7f5 fix(scripts): preserve latest actionable PR feedback in agent prompt
- 59a8cda8 feat(scripts): update
- 749155f2 fix(scripts): filter unresolved inline bot comments and fetch latest thread comment
- fa3a2d5b fix(scripts): include unresolved review threads and harden gh error handling
- 32b28379 feat(scripts): update script
- 22bd3d16 feat(scripts): bolster script
- 499ed486 refactor(scripts): harden pr-agent prompt CI diagnostics and failure reporting
- 4de80db8 feat(scripts): add intentional failure test case
- 02fb5fbc feat(scripts): remove deprecated PR prompt scripts and clean up .gitignore
- 5e5b575d chore(scripts): update script
- f1f2238c feat(scripts): drop low confidence comments
- 4ddb1581 feat(scripts): add .pr-agent-prompt.md to .gitignore
- 0429df47 feat(scripts): improve output
- ec497c77 feat(scripts): add PR agent prompt generator command
- a0fba42f Merge pull request #229 from thetigeregg/feat/bumps
- 00ac6dde ci(workflow): bump create-github-app-token action to v3
- 9a9d5aaf chore(deps): bump tiptap, commitlint, lint-staged, and express-rate-limit
- f7f9d950 Merge pull request #221 from thetigeregg/feat/popularity
- 06c785f5 chore: fix
- 9b6f2b49 fix(popularity): align release-date index fallback and unify fix-prompt bullets
- 447426bf fix(popularity): remove redundant feed slicing and centralize SQL row limit
- 46013c37 chore: fix test
- 1ba45f72 fix(popularity): centralize advisory lock handling and remove duplicate feed window filtering
- ce0b4f5f fix(popularity): harden ingest summaries and release date parsing
- d690b5e9 feat(pr-fix): enhance prompt with additional validation requirements for frontend and backend
- 8f836f00 fix(server): decouple popularity ingest igdb config and handle igdb 429 cooldown
- 861339fb test(popularity): raise backend branch coverage for ingest and feed edge cases
- 3f719edb fix(scripts): harden PR run selection and isolate CI coverage artifacts
- e7e64f47 chore: update gitignore
- 17d64689 chore: update script
- 9b5fcda9 chore: add debug
- 99f24225 chore: add new script
- a7196004 chore: update gitignore
- 0445744d chore: update script
- a9677ec3 chore: update script
- 1668b792 chore: update script
- 070e5ae6 fix(scripts): forward PR prompt args and select CI runs by PR branch
- 949701a0 fix(server): align popularity release date SQL, index, and route query tests
- bbd256de feat(pr-ci-prompt): add script to generate CI failure fix tasks for PRs
- 22cb237d chore: add ci script
- 4d8ebcb4 fix(popularity): persist ingest token cache and remove unused pr summary arg
- c094f4b0 fix(server): address popularity feed SQL windowing and ingest pair insertion review feedback
- 724d0731 fix(scripts): avoid null review cursor and match coverage run to PR branch
- 7ecb6a0a fix(popularity): address PR review feedback for ingest locking, tests, routes
- d7cbe0d4 chore: update scripts
- 01d16cc1 chore: update script
- 12db0edc feat(scripts): add PR coverage task prompt generator
- 904e311d perf(server): batch missing game inserts in popularity ingest
- b143ea35 chore: update script
- b5399e5a chore: update gitignore
- 07939848 feat(scripts): add PR review prompt script and npm runner
- d91f55af feat(scripts): add pr review prompt generator script and npm alias
- 39c9bef0 feat(scripts): add PR review prompt generator and npm command
- dde7e0dc feat(scripts): add PR review prompt generator and npm command
- fdd0c015 fix(popularity): enforce feed score threshold and backfill missing game-platform variants
- a80422c7 fix(popularity): batch signal upserts and add platform-disambiguated feed items
- 35ca2ba7 refactor(popularity): purge legacy popularity proxy paths and wire direct IGDB ingest
- f8813cab feat(popularity): add IGDB popularity ingest and global discovery feeds

## v1.4.0 - 2026-03-16

- 038f8f3e Merge pull request #230 from thetigeregg/feat/popularity-ui
- 6ae96888 fix(explore): rename feature flag usage to explore-enabled naming
- ee0b21ce Merge branch 'main' into feat/popularity-ui
- 2881d2c7 refactor(explore): rename refresh handler and feature flag for mode-agnostic explore feeds
- 2e32e330 Revert "fix(ci): harden PR CI prompt generation for missing failure logs"
- c7da5969 fix(ci): harden PR CI prompt generation for missing failure logs
- 5657c324 feat(popularity): dedupe ingest payload lists and harden popularity explore detail loading
- 468d9578 Merge branch 'main' into feat/popularity-ui
- 85e72dba style(explore): move discover mode segment into toolbar container
- a9b38d11 ci(workflow): bump create-github-app-token action to v3
- a5ac0c13 chore(deps): bump tiptap, commitlint, lint-staged, and express-rate-limit
- bfcaeb71 feat(popularity): add discover popularity mode with detail-ready metadata
- 1a1b829b fix(api): dedupe popularity feed by igdb game id keeping highest score
- 7c6210ec fix(api): dedupe popularity feed items by game platform key
- fbe30c85 fix(api): use contiguous SQL placeholders in popularity feed queries
- a8357690 feat(api): add popularity feed client support for trending endpoints

## v1.5.0 - 2026-03-16

- 7429b7b8 Merge pull request #232 from thetigeregg/feat/popularity-ui
- da977a8f fix(popularity): refresh release year in game payloads
- f798dbda test(server): isolate config env clamp test
- 720ad3f9 fix(server): isolate popularity config env test
- 66e50504 fix(popularity): narrow existing payload refresh fields
- bb7901bf fix(popularity): cache existing game refresh payloads
- 0c219286 fix(popularity): document feed row limit clamp and isolate config test
- 781837fd fix(popularity): narrow refresh payload updates and clamp feed row limit
- 1bfa8435 chore: force push
- 491e82c6 fix(api): refresh existing popularity game payloads during ingest
- 41cac9cd feat(api): make popularity feed row limit configurable

## v1.5.1 - 2026-03-16

- ff5dc24a Merge pull request #233 from thetigeregg/feat/popularity-ui
- 8f8b779a fix(api): align owned list partial index predicate
- d37142cf fix(api): optimize popularity feed dedupe query
- 66d0eb13 fix(api): rewrite popularity feed dedupe with row ranking
- 2e58f578 fix(api): preserve index-friendly popularity dedupe
- d510a1e8 Merge branch 'main' into feat/popularity-ui
- b6187e56 fix(popularity): exclude owned games from feed query
- 6ef3fca6 fix(popularity): dedupe feed rows before applying limit

## v1.5.2 - 2026-03-16

- d0dd1f00 Merge pull request #234 from thetigeregg/feat/popularity-ui
- 2602ef62 test(api): cover release monitor precision branches
- bdfde06c fix(api): use IGDB release_dates precision for release monitor
- 9a6e2a2f fix(api): cap unreleased release monitor recheck window to 15 days

## v1.5.3 - 2026-03-16

- b9d1db11 Merge pull request #235 from thetigeregg/feat/popularity-ui
- 0bf473e8 fix(ui): harden game detail swiper lifecycle and add carousel unit tests
- 1d2776bb fix(ui): migrate game detail swiper to TypeScript init and refresh

## v1.5.4 - 2026-03-17

- 5c34dc1c Merge pull request #237 from thetigeregg/feat/format
- fff3641f fix(lint-staged): update lint-staged configuration to include additional file types for prettier
- 1bbbe3c1 style: format code
- e27cce62 fix(prettier): update .prettierignore to include additional directories and file types
- babeeb74 Revert "style: format code"
- bc14c438 fix(prettier): add configuration for docker-compose YAML files
- e363bc22 fix(lint-staged): simplify lint-staged configuration for file types
- 430f29e7 fix(pre-commit): disable concurrency for lint-staged
- d7ad80d2 fix: update order
- 0601e5bf fix: prevent concurrency issues
- fccfac92 style: format code
- 658aa5f5 fix(lint-staged): update Prettier command to ignore unknown file types
- 685b3aa3 fix(prettier): update configuration for improved formatting and overrides
- f5f6a294 fix(lint): update lint-staged configuration to apply Prettier to all file types

## v1.5.5 - 2026-03-17

- 019cf813 Merge pull request #236 from thetigeregg/feat/popularity-ui
- ca733892 test(explore): expand popularity hydration coverage
- 7a6057a1 fix(tests): update explore page spec to correct array syntax
- 1279c203 Merge branch 'main' into feat/popularity-ui
- c53931f5 fix(explore): stop popularity hydration reruns after mode switch
- a533f3b4 fix(explore): unblock popularity pagination hydration
- 6b984a73 fix: pipeline
- 9b5b62d6 fix: update pipeline
- 2621077d fix(explore): stop popularity hydration after mode changes
- 4fcfec9e fix(explore): cache visible popularity items
- f2e4778e fix: always upload coverage
- bb61b73b fix(explore): preserve popularity hydration reruns
- 75eeb4ea fix: scss import
- 875e07b7 fix(ci): adjust checkout step indentation in CI workflow
- d1e942e1 Revert "fix(lint): update lint-staged configuration to apply Prettier to all file types"
- 7d349cc0 Revert "fix(prettier): update configuration for improved formatting and overrides"
- 51263102 Revert "fix(lint-staged): update Prettier command to ignore unknown file types"
- c8064440 fix(lint-staged): update Prettier command to ignore unknown file types
- a7fac27b fix(prettier): update configuration for improved formatting and overrides
- 01a1f9cb fix(lint): update lint-staged configuration to apply Prettier to all file types
- c7bd2a19 fix(ci): streamline coverage file uploads in Codecov action
- 6b792822 fix(styles): replace deprecated Swiper Sass imports with CSS url imports
- 936a9b0f ci(workflow): move Playwright failure artifact upload before coverage steps
- 496df5e7 ci(workflow): run backup and UI checks before combined coverage upload
- 863e3bec fix(explore): run popularity catalog hydration in background during feed load
- 2c5f587d fix(explore): single-flight popularity catalog hydration and add overlap tests
- 3972b029 fix(ui): hide newly added popularity games from popularity list
- bb5870f7 fix(explore): prehydrate visible popularity catalog details before modal open

## v1.5.6 - 2026-03-17

- 61b22f62 Merge pull request #244 from thetigeregg/feat/popularity-ui
- f64fe145 Merge branch 'main' into feat/popularity-ui
- 53fadc90 fix(styles): change swiper imports to use url() syntax

## v1.5.7 - 2026-03-17

- 0865a5ba Merge pull request #243 from thetigeregg/feat/bp
- abd3ae85 Merge branch 'main' into feat/bp
- a00a3b4c chore: update @angular-eslint and typescript-eslint
- 9d1c49e3 chore: update @angular-eslint and typescript-eslint
- 6984a7e7 Revert "chore: update @angular-eslint and typescript-eslint packages to latest versions"
- 48864ae3 Merge branch 'main' into feat/bp
- 239291e1 chore: update @angular-eslint and typescript-eslint packages to latest versions
- 3cb527ed Revert "chore: update tiptap and angular-eslint dependencies to latest versions"
- 97252e80 chore: update tiptap and angular-eslint dependencies to latest versions

## v1.5.8 - 2026-03-17

- 5ef3cce7 Merge pull request #246 from thetigeregg/feat/scriptsz
- 7e76862d fix: suggestions
- d612b1f1 fix: scripts
- 5083734a fix(scripts): include GitHub Advanced Security review comments in PR tasks
- d4b2ec11 fix(scripts): skip empty security reviews in PR prompt generation
- 5057b4a8 fix(scripts): skip outdated and security bot review threads

## v1.5.9 - 2026-03-17

- d2ccd0bc Merge pull request #245 from thetigeregg/feat/meta
- dfdf9e25 fix(metacritic-scraper): remove flaky search readiness waits
- 6803dd7c fix(metacritic-scraper): align search readiness with link-first cards
- dfd8f968 fix(metacritic-scraper): scope Metacritic results readiness selector
- ab973513 fix(metacritic-scraper): reject non-positive scraper timeouts
- 12b99507 fix(metacritic-scraper): guard title parsing and clamp timeouts
- bf17f66d fix(metacritic-scraper): harden search readiness and timeout parsing
- 4c25b59c fix(metacritic-scraper): resolve remaining parser review feedback
- 97070590 fix(metacritic-scraper): inline parser defaults for browser evaluation
- b2bd7b69 Merge branch 'main' into feat/meta
- d37b5ce8 fix(metacritic-scraper): centralize search selectors and tighten readiness wait
- 7fb3c9e4 style(metacritic-scraper): normalize search parser test string quotes
- 530a4a6e fix(metacritic-scraper): harden Metacritic search parsing
- ef8f6537 fix(metacritic-scraper): support current search DOM and add parser regression tests
- 03be6618 fix(metacritic-scraper): restore search matching after DOM structure changes

## v1.6.0 - 2026-03-17

- 321d0d2b Merge pull request #247 from thetigeregg/feat/meta-year
- d69519dc fix: revert
- 3aeb8e75 Revert "ci(workflow): move Playwright failure artifact upload before coverage steps"
- 8d806541 Revert "fix(ci): streamline coverage file uploads in Codecov action"
- 2f69d6ae Revert "fix: always upload coverage"
- e7065cdb Revert "fix: update pipeline"
- a6d5305a Revert "fix: pipeline"
- 4f5a756a test(metacritic-scraper): rename ranking test file
- 39a5c4be fix(metacritic-scraper): defer Nuxt payload parsing and isolate ranking helper
- 72fcb6f1 refactor(metacritic-scraper): remove ranking-specific search changes
- ceab3c1b feat(metacritic-scraper): improve image URL normalization and update tests
- 394e7b9c feat(rankCandidate): implement ordered token sequence matching and add tests
- 2406cad2 feat(metacritic-scraper): enhance search result extraction with fallback for missing release years

## v1.6.1 - 2026-03-18

- c84ea92a Merge pull request #248 from thetigeregg/dependabot/npm_and_yarn/server/fast-xml-parser-5.5.6
- 34f92a7d chore(deps): bump fast-xml-parser from 5.4.2 to 5.5.6 in /server

## v1.7.0 - 2026-03-19

- c21c116e Merge pull request #252 from thetigeregg/feat/bumpa
- 2c6f888f fix(scripts): align ncu-all project targeting with PR description
- 714bff73 fix(deps): pin npm-check-updates and harden ncu-all script
- 08219fab chore(deps): update jsdom to version 29.0.0
- d920705e feat: add script to update all project dependencies using npm-check-updates
- fc482747 fix: rename non-Angular dependency update script in package.json
- 4550e20e feat: add script for non-Angular dependency updates in package.json
- 74d51311 chore(deps): update @tiptap dependencies to version 3.20.4
- 472d13ec chore(deps): update @angular/cdk dependency from 21.2.2 to 21.2.3
- fb2cb712 chore(deps): update Angular dependencies to version 21.2.5
- 028ef2db feat: add Angular dependency update scripts to package.json

## v1.8.0 - 2026-03-19

- 08ce9271 Merge pull request #249 from thetigeregg/feat/backmatch
- 4b36cdcb Merge branch 'main' into feat/backmatch
- 19b148f5 Revert "fix(discovery): reject empty review match patches"
- ab6159fa fix(discovery): reject empty review match patches
- 2f91a27d fix(admin-discovery-match): enhance review field validation in patch route
- 60813d42 fix(discovery): guard empty admin enrichment requeues
- 0dcf028e docs(discovery): clarify admin pricing requeue behavior
- 87b1f24d fix(admin-discovery-match): use explicit queue status colors
- 433de491 fix(discovery): normalize admin discovery base url
- 27d1af77 fix(discovery): preserve unknown admin pricing free state
- 695524e7 fix(discovery): resolve admin match retry and pricing patch semantics
- 1d4761ba fix(worker): limit psprices backoff to discovery refreshes
- a27cd230 fix(discovery): validate admin review match source
- 70ab9ebd fix(discovery): move admin match initial load to ngOnInit
- e9b6a422 fix(ui): guard discovery permanent-miss reset without write token
- b533d141 fix(discovery): handle explicit enrichment keys and rearm psprices retries
- 3b6d78ac feat(discovery): add default pricing source handling for Steam rows in pricing patch route
- f9ae3f81 feat: implement validation for positive integers in admin discovery routes and forms
- eb90b52f feat(discovery): enhance pricing source handling and add tests for admin discovery routes
- 95f82b76 test: add unit tests for discovery game key parsing and normalization
- 39b24d3a refactor: consolidate and enhance admin discovery match utilities
- 1d2f730a feat(discovery): implement transaction handling for admin discovery match routes
- 4fcf605a Potential fix for code scanning alert no. 67: Incorrect suffix check
- 5e0a9f10 Potential fix for code scanning alert no. 68: Incorrect suffix check
- f45db0df feat(discovery): enhance admin discovery routes with improved validation and concurrency handling
- 0c7efbcc feat(discovery): enhance unmatched route filtering and improve pricing job handling
- e005bf7e feat(discovery): enhance admin discovery match routes with key-based filtering
- f034311a fix(discovery): correct admin match state handling
- 85890a86 fix(discovery): address admin pricing review feedback
- c6f8cb76 Merge branch 'main' into feat/backmatch
- e32ffe8b feat: add mock for server icon in settings page tests
- 51de2b21 feat: enhance admin discovery match routes with PSPrices metadata handling
- f7b61732 feat: enhance PSPrices revalidation with retry state management and backoff logic
- e1186cde feat: implement pricing source resolution and enhance pricing candidate handling
- 6ce560ba feat: add pricing filter logic to exclude unsupported platforms in discovery matches
- aba51e35 feat: add tests for normalizeEntry and ranking functions to validate multiplayer timings
- f4ff46b6 feat: enhance admin discovery match routes with pricing refresh functionality
- 8a3bc460 feat: add automated pre-PR cleanup agent script for code quality improvements
- 65b49799 feat: add HLTB lookup context and refresh logic for locked matches
- 61ce405b feat: enhance admin discovery match functionality with grouped items and improved UI labels
- be144768 feat: add documentation for Discovery Match Admin functionality and usage
- 58babe63 feat: refactor searchbars and add active queue status message in admin discovery match UI
- 7e21db2f feat: enhance admin discovery match UI with improved button styles and layout adjustments
- 80f762bd feat: add debug options and restore Discovery Match Admin item
- 5e63cd8a Merge branch 'main' into feat/backmatch
- ec1a80f9 feat: refactor admin discovery match functionality to use device write token, remove admin token
- 9afa41c4 feat: add Discovery Match Admin functionality and update related Postman collection and tests
- 3039af31 feat: enhance queue status messages with detailed descriptions for targeted rows
- 65274f92 feat: implement targeted discovery enrichment requeue functionality
- 79b2e156 feat: add queue status messages and tones for enrichment processes
- c0a0b9bf Merge branch 'main' into feat/backmatch
- 7062e08e feat: implement requeue enrichment functionality for admin discovery matches
- 9dac5cfb feat: add requeue enrichment functionality for admin discovery matches
- 54055f3e feat: implement candidate search functionality for HLTB, review, and pricing providers
- 2d398bbd feat: add admin discovery match page and related services
- c8e45c02 feat(api): add discovery match admin routes

## v1.8.1 - 2026-03-19

- f3eb4154 Merge pull request #253 from thetigeregg/feat/bumpa
- a6c1746b fix(scripts): include only actionable reviews in discussion items
- 967f4f29 fix: update
- b7e16a9b fix: update
- 21146b83 fix(scripts): preserve empty changes-requested review summaries
- 4e945caa fix(scripts): skip empty PR review summaries
- 25ec8d77 Merge branch 'main' into feat/bumpa
- 94ad93f1 fix(scripts): preserve actionable review summaries
- 23baceb0 fix(scripts): ignore blank PR review summaries
- 07d2b8c3 Merge branch 'main' into feat/bumpa
- 240bc9c1 fix: refine discussion review item collection to exclude non-code comments

## v1.9.0 - 2026-03-19

- f3585f24 Merge pull request #254 from thetigeregg/feat/rates
- 0b89c20e fix(api): handle recommendation metadata hydration safely
- 88e8ac08 fix(explore): address recommendation metadata review feedback
- 47ec319a feat: add game-by-id rate limit configuration to environment files and documentation
- 19150d25 feat: add game-specific rate limit configuration and update explore page logic

## v1.9.1 - 2026-03-19

- a61f5f27 Merge pull request #255 from thetigeregg/feat/rates
- b7f38d36 fix(recommendations): address lane pagination review feedback
- 8b984c32 fix(explore): unblock cached lane hydration and align paging defaults
- 96a8cd46 fix(api): cap paged feeds and stabilize legacy recommendation lanes
- 75bfedf2 fix(recommendations): bound paginated offsets for feed and lane queries
- e39b9a11 fix(explore): prevent feed duplication and support legacy lane payloads
- d2604f68 fix(recommendations): preserve legacy lanes response without lane query
- 53067100 test(popularity): add tests for response page metadata limit and error handling
- 162e964e fix(explore): guard paged recommendation and popularity merges
- 2b3f0afc Merge branch 'main' into feat/rates
- 8e99dddd fix(recommendations): correct lane pagination and query typing
- 4f8a8e3d refactor: explorePage to enhance popularity feed handling and recommendation lane management

## v1.10.0 - 2026-03-19

- f58bf817 Merge pull request #256 from thetigeregg/feat/cache
- 01981bf7 fix(server): harden queued igdb cache revalidation keying and add worker-path tests
- 50c3304a fix(server): cancel IGDB revalidation response body in queued worker path
- 36d478a5 Merge branch 'main' into feat/cache
- a5392d83 fix(server): queue IGDB stale revalidation and align miss metrics
- f1ffa48d fix(igdb-cache): ensure response body is canceled after revalidation
- d1c19fbc fix(server): handle IGDB response stream cleanup and revalidation scheduling failures
- 588e18b1 test(server): use CacheMetricSnapshot in cache observability payload typing
- a87ced9c feat(igdb-cache): enhance game ID normalization to ensure safe integer values
- c8fd9026 feat(igdb-cache): add tests for cache behavior with invalid game IDs and error handling
- 01f40ee0 feat(igdb-cache): implement IGDB caching mechanism with metrics tracking

## v1.10.1 - 2026-03-19

- 65112094 Merge pull request #257 from thetigeregg/feat/script-again
- 99efb5c1 Merge branch 'main' into feat/script-again
- 918117b6 fix(scripts): restore gh download buffer limit
- 548834af fix(pr-agent): improve artifact download logging to use console.error and console.warn
- dd609f90 fix(pr-agent): normalize author login handling and enhance artifact download error logging
- 595b7d4c Merge branch 'main' into feat/script-again
- 039fa4ec fix(scripts): harden PR review thread filtering
- fb434210 fix(recommendations): address lane pagination review feedback
- 47d939ec fix(explore): unblock cached lane hydration and align paging defaults
- a52eb183 fix(api): cap paged feeds and stabilize legacy recommendation lanes
- 628f19d7 fix(recommendations): bound paginated offsets for feed and lane queries
- 888c2bed fix(explore): prevent feed duplication and support legacy lane payloads
- 33ed0f06 fix(recommendations): preserve legacy lanes response without lane query
- 3f671aab test(popularity): add tests for response page metadata limit and error handling
- 3158eee0 fix(explore): guard paged recommendation and popularity merges
- 2f655456 fix(recommendations): correct lane pagination and query typing
- 7a3b8f2f refactor: explorePage to enhance popularity feed handling and recommendation lane management
- d9e3a92c fix: update
- 64161167 fix: update
- ea8e56a5 fix(pr-agent): improve coverage artifact download handling and add debug logging
- 3890e354 fix: update
- f98036db fix(pr-agent): enhance isActionableThread logic to handle null threads and filter GHAS comments

## v1.10.2 - 2026-03-19

- 67cfdd15 Merge pull request #261 from thetigeregg/feat/bumperzaa
- e4616d4e chore: update dependencies in package-lock.json

## v1.10.3 - 2026-03-20

- 925379d7 Merge pull request #262 from thetigeregg/dependabot/npm_and_yarn/server/fast-xml-parser-5.5.7
- 93c3ff62 chore(deps): bump fast-xml-parser from 5.5.6 to 5.5.7 in /server

## v1.11.0 - 2026-03-20

- 34e7914e Merge pull request #260 from thetigeregg/feat/script-again-again-again-again
- 8e9eb115 feat(dev-cleanup): refactor common Git directory handling and update tests
- b9681164 Merge branch 'main' into feat/script-again-again-again-again
- ed228f71 test(dev-cleanup): ensure temporary directories are cleaned up after tests
- 4c34a276 feat(dev-cleanup): enhance formatCleanupSummaryLine to include paths
- 8fa196d9 fix(scripts): harden dev-cleanup path formatting and pruning
- 850d86ec feat(tests): add normalization check for current worktree in removeMergedWorktrees
- d3048899 feat(dev-cleanup): enhance path normalization and add tests for formatWorktreeDisplayPath
- d9d6f375 feat(dev-cleanup): add isEntrypoint function and corresponding tests
- 770486f2 fix(scripts): make script test runner cross-platform
- f983a28f feat(dev-cleanup): update REPO_ROOT resolution to use git common directory
- 80fa1078 Merge branch 'main' into feat/script-again-again-again-again
- fb8e802e feat(dev-cleanup): enhance worktree path logging and add formatWorktreeDisplayPath function
- 92ba7066 feat(dev-cleanup): enhance parseWorktrees function and update cleanup summaries for dry-run mode
- 93af138f Merge branch 'main' into feat/script-again-again-again-again
- 89f0fadf feat(tests): add script tests to CI workflow and define test:scripts command
- a5cc711d feat(dev-cleanup): add dry-run functionality and enhance branch removal logic
- 81740fec feat(dev-cleanup): implement orphaned worktree removal and add tests
- 4c038aa4 feat(dev-cleanup): add formatCleanupSummaryLine function
- 5c13ed68 feat(dev-cleanup): enhance removeMergedWorktrees to return a summary
- 20f8db85 feat(cleanup): enhance dev-cleanup script with worktree management and add tests

## v1.12.0 - 2026-03-20

- 9183dfb6 Merge pull request #259 from thetigeregg/feat/rate-limit
- 20e5569b docs(rate-limit): document shared IGDB outbound throttle knobs
- 3e6563a7 fix(handler): simplify getIgdbOutboundLimiter calls in handleRequest
- 03c87069 feat(config): add outbound IGDB metadata proxy rate limit configuration
- 927dc585 fix(server): round image proxy rate limit window overrides up
- 7c79005e fix(server): address rate limit PR review feedback
- 04434f35 Merge branch 'main' into feat/rate-limit
- e6625a0d feat(tests): add tests for formatTimeWindow and handleRequest options validation
- ca963ab4 feat(rate-limit): streamline rate limit configuration by removing requestTimeoutMs
- 1cf2fd25 Merge branch 'main' into feat/rate-limit
- 98663d98 feat(provider-limiter): implement drainConcurrencyWaiters function and update reset behavior
- 23ff67fa feat(rate-limit): add maxConcurrent option to rate limit configuration
- 8538d577 fix(server): address rate limit PR review feedback
- ff953070 fix(worker): remove unused IGDB cooldown helpers
- b50d87e5 Merge branch 'main' into feat/rate-limit
- 899340c2 fix(worker): address provider limiter PR feedback
- c16c8bb0 Merge branch 'main' into feat/rate-limit
- 70038c6a fix(rate-limit): resolve remaining PR review notes
- e5aa59a9 test(provider): add comprehensive tests for rate limiting functionality
- 43a5fb58 Merge branch 'main' into feat/rate-limit
- 7fbad413 Merge branch 'main' into feat/rate-limit
- d652250e refactor: rate limiting configuration and environment variables
- 62fd0961 refactor: rate limiting implementation across services

## v1.13.0 - 2026-03-20

- eea7d7df Merge pull request #263 from thetigeregg/feat/hltb-tbd
- c568e4ba Merge branch 'main' into feat/hltb-tbd
- 974926b2 Merge branch 'main' into feat/hltb-tbd
- 04b9fe53 feat(igdb-proxy): add tests for sanitizing
- 08e6f926 feat(rankCandidate): enhance ranking logic with spinoff token handling and semantic title variants
- 96c39dcf feat(search-parser): add regex pattern to extract year from titles and update tests
- 5d68fd22 feat(metacritic): add support for multiple platform aliases in candidate ranking and search results
- 1fbbfa62 feat(search-parser): add test for normalizing TBA payload years in tbd results
- 02635139 feat(rankCandidate): enhance ranking logic for base games
- ceaaef4f feat(search-parser): add normalization for release year and implement tests

## v1.14.0 - 2026-03-20

- dc314f16 Merge pull request #264 from thetigeregg/feat/release-dates
- 2fe8eb50 fix(settings): apply imported release date preferences before storage sync
- aee38569 feat(game-list): refactor release date formatting; use consistent date formatter
- 9ef82278 feat(game-list): improve release date handling and formatting; add parsing for ISO timestamps
- b070c999 feat(game-list): shorten month names in release date labels
- 0b236c9c feat(settings): remove extra whitespace from heart icon color attribute
- 973d784a feat(game-list): enhance full release date formatting with ordinal suffixes
- 74f5537a feat(settings): add icons for release date display options
- ea4ac9d4 feat(settings): update ion-select labels for release date display options
- a52bb0b0 feat(release): add configurable release date display options

## v1.15.0 - 2026-03-20

- a0665631 Merge pull request #265 from thetigeregg/feat/search-detail
- 3ef3de33 test(list-page): cover list page PR note scenarios
- 8270df77 Revert "fix(list-page): preserve add-game detail platform context"
- c3075235 Revert "fix(game-search): avoid nested interactive controls in search results"
- 045783f4 fix(open-external-url): ensure global mocks are unstubbed after each test
- 05d587d1 fix(game-search): avoid nested interactive controls in search results
- d72000e4 fix(game-search): remove unreachable add-to-library status
- df9589aa fix(list-page): preserve add-game detail platform context
- 3e535ad9 fix(ui): support same-origin manual links in external URL helper
- c87ed6cd fix(list-page): clear add-game detail loading state immediately on fetch error
- 362a06d7 feat(open-external-url): enhance URL handling by normalizing protocol-relative URLs
- 39740401 feat(open-external-url): implement openExternalUrl utility
- a534d755 fix(list-page): reuse add-game detail lookup on IGDB errors
- dbf8da50 fix(game-search): allow detail row clicks when item is the interactive element
- 8d090e32 test(core): align platform context spec with expected label behavior
- 8f013742 fix(detail-shortcuts): update positioning to use CSS variables for safe area insets
- e35f3d13 feat(list-page): add detail shortcuts and video modal functionality
- 6ba0ed42 fix(game-search): update requestDetail method to handle event and prevent nested interactions
- 9402c006 fix(game-search): update requestDetail method to handle platform selection
- 1dba21ad fix(settings): update labels for collection and wishlist display settings
- f2eb30ad Merge branch 'main' into feat/search-detail
- fe4a23e4 feat: implement game catalog platform context handling

## v1.16.0 - 2026-03-21

- 8d86fbfa Merge pull request #267 from thetigeregg/feat/wishlist-prices
- fda1602f fix(enrichment): preserve locked mobygames review context during refresh
- 207a8a10 feat(tests): add PSPrices refresh job builder tests for unsupported, backoff
- a6e05db3 feat(discovery-match): enhance locking mechanism explanations and UI notes
- 2928acee feat(discovery-enrichment): enhance locked HLTB and review provider handling with saved query fields
- 68a95f49 feat(psprices): implement PSPrices refresh job builder and related tests

## v1.17.0 - 2026-03-21

- 9df37192 Merge pull request #266 from thetigeregg/feat/external-link
- 7442e8cd Merge branch 'main' into feat/external-link
- aab370ef fix(websites): accept protocol-relative and Nintendo Europe links
- 3af97122 fix(websites): harden external link normalization and remove dead shortcuts
- 616e215b fix(websites): reject credential-bearing external urls
- 27f15a6d refactor(tests): simplify icon retrieval by using findItemByHostname function
- a2af0489 feat: enhance URL sanitization and validation in detail websites modal
- 09db1b07 fix(websites): simplify provider fallback and cache ttl naming
- ce6db94d feat: implement URL sanitization for external links and enhance website trust validation
- 47e4415e test(websites): raise external link coverage for CI
- 89ca4bc7 fix(websites): resolve external link review feedback and enrichment reruns
- 65697d2c feat: update Steam URLs to remove specific app IDs for normalization
- f4355db2 feat: update PlayStation icon style to use deep ocean color variant
- 2d37b489 feat: simplify website item icon styles and update Nintendo SVG fill color
- ba64cf4c feat: update website type IDs for Nintendo and Xbox, and improve icon resolution logic
- ae3f7ce3 feat: add support for Bluesky with new icon styles and update color variables
- ce060b2e feat: reorder website items to prioritize official, community wiki, and wikipedia links
- f130c909 feat: enhance website modal logic to include additional platforms and improve label resolution
- 6be132a8 feat: add deep ocean icon style for library website item
- 48ca346a feat: remove unsupported storefront host fallbacks from isKnownStorefrontUrl function
- 005c3ee4 feat: update website icons and add library icon support in detail websites modal
- 2dc81aad feat: implement website filtering logic to exclude unsupported links
- a8d3b7e0 feat: enhance metadata enrichment logic to handle empty websites array
- 18b02008 feat: add websites modal and related functionality to list page
- d23dc767 feat: enhance website classification for itch.io and add comprehensive tests
- 4ffd9c22 feat: add website normalization logic to GameSyncService
- 7e60d8b5 Merge branch 'main' into feat/external-link
- 885f693e feat: update Google icon styling in detail websites modal
- 686d5ebb feat: add GameFAQs, Nintendo, and Xbox icons to website modal and update related logic
- 48b6c3d0 feat: add Discord and Reddit icons to website modal and update related logic
- 4dfcefe4 feat: enhance website modal with semantic icons and refactor icon handling
- f50345a2 feat: add @semantic-icons/simple-icons dependency to project
- 3de89953 feat: add link icon to detail shortcuts FAB and update icon registration
- 56bcf3ff feat: add websites modal and refactor website handling in game detail
- 79b85c0c refactor: update website handling by replacing sourceId/sourceName with typeId/typeName
- 2f406699 refactor: simplify handling of websites by removing storefrontLinks references
- 2b2083c2 refactor: rename storefront links to websites and update related logic
- 19edc981 Merge branch 'main' into feat/external-link
- 2270c4c9 feat: implement storefront links display and normalization in game detail component
- 89d88c8c feat: enhance metadata enrichment to support storefront links and steam app IDs
- 84411e76 Merge branch 'main' into feat/external-link
- bdcf5f49 feat: add storefront links normalization and persistence

## v1.18.0 - 2026-03-21

- 87552ea4 Merge pull request #268 from thetigeregg/feat/menu-close
- 543499f2 fix(explore): separate header popover dismiss handling
- 320ed851 feat: add test for settings routing on header popover dismissal rejection
- 2c8a2c94 feat: add PopoverController to ExplorePage for improved popover management

## v1.19.0 - 2026-03-21

- 357b9a22 Merge pull request #269 from thetigeregg/feat/crash
- fad9a7f4 fix(explore): require nextOffset for similar load-more
- ef7c7d81 fix(explore): auto-fill filtered similar recommendation pages
- ea7a9156 fix(explore): reset similar recommendations state on detail modal close
- 57a0132b Merge branch 'main' into feat/crash
- d7c541c8 fix: remove redundant initialization of similarRecommendationsPage
- 8c16f8b7 feat: implement pagination for similar recommendations with offset and limit
- bed077a0 feat: enhance similar recommendations metadata hydration and loading behavior

## v1.20.0 - 2026-03-22

- b55b210d Merge pull request #270 from thetigeregg/feat/show-more
- ee457127 fix(game-detail): preserve detail text toggle expandability
- e0159831 feat: improve detail text expandability logic in GameDetailContentComponent
- c2802c6d Merge branch 'main' into feat/show-more
- 630ea33b feat: preserve expanded detail text on game refresh and improve toggle functionality
- 158632b7 feat: enhance detail text toggle functionality for summary and storyline
- 5d7be486 feat: add detail text toggle functionality and reset on game change

## v1.21.0 - 2026-03-22

- cc76ccfc Merge pull request #271 from thetigeregg/feat/screenshots
- 784d1f8e test(media): add coverage for 720p screenshot normalization branches
- ffcfd3f8 fix(game-detail): address remaining media slide review feedback
- 60392878 Merge branch 'main' into feat/screenshots
- 477eee6b feat(game-detail): adjust eager-load logic to only load the active media slide
- 587f615e feat: update screenshot size to 720p across the application
- 5fcfca86 fix(game-detail): update eager-load logic to only load the first slide
- bbe5f317 feat(detail-media): enhance backdrop handling and media slide structure

## v1.22.0 - 2026-03-22

- 7dab074f Merge pull request #272 from thetigeregg/feat/crash
- 5db84705 fix(ui): align detail trace push logging and harden cache tests
- c287057e feat(explore): implement debug logging and optimize detail data caching

## v1.23.0 - 2026-03-22

- 6178d395 Merge pull request #273 from thetigeregg/feat/expand
- c39219d6 feat(explore): enhance explore page tests with swiper mock
- 1a1bb9da feat(game-detail): add resize observer for detail text elements and refresh logic

## v1.24.0 - 2026-03-23

- bc14599f Merge pull request #274 from thetigeregg/feat/finda
- 7782a5bf test(sync): assert cover field preservation in upsert SQL
- 960264bc feat(sync): add test for preserving cover metadata when payload omits cover fields
- d6b1cabf feat(sync): enhance game payload handling with cover field reconciliation

## v1.25.0 - 2026-03-23

- 6f356902 Merge pull request #277 from thetigeregg/feat/bumpa
- ef18291d Merge branch 'main' into feat/bumpa
- 632701b2 feat(ncu-all): add format option to ncu command for better output
- ba64b2b7 fix(deps): update @types/pg to version 8.20.0
- 245b4c0b fix(deps): update jsdom and undici to latest versions

## v1.26.0 - 2026-03-23

- 022682b0 Merge pull request #278 from thetigeregg/feat/rates
- 4b5a431a feat: add CodeQL configuration to exclude false positives for rate limiting

## v1.27.0 - 2026-03-23

- 1e03f7f7 Merge pull request #279 from thetigeregg/feat/fixagain
- aa4093ef fix(sync): guard syncNow against reset promise failures
- dd9de4a0 fix(sync): make local sync reset non-blocking
- 48292d30 fix(sync): serialize local sync state reset
- a6a0e0f2 feat(sync): enhance logging for pullChanges with cursor details
- cbbb8ace feat(settings): add reset local sync state functionality

## v1.27.1 - 2026-03-25

- 283e95da Merge pull request #280 from thetigeregg/feat/crapper
- 6a58a6cc fix(caddy): add headers for runtime configuration caching

## v1.27.2 - 2026-03-25

- ab2cebb3 Merge pull request #282 from thetigeregg/dependabot/npm_and_yarn/server/fastify-5.8.3
- 4fcb22fa chore(deps): bump fastify from 5.8.2 to 5.8.3 in /server

## v1.28.0 - 2026-03-26

- 93ef176b Merge pull request #281 from thetigeregg/feat/persa2
- b911534c fix: support protocol-relative URLs for custom cover images
- 8c5bde72 Merge branch 'main' into feat/persa2
- 25f9e3d5 fix(sync): preserve cleared cover fields during pending writes
- e46105ab fix(covers): short-circuit custom cover URL sanitization
- f5e648d5 fix(covers): align custom cover validation and review tests
- 78ed0632 fix(covers): preserve stale custom covers and block unsafe custom cover display
- de2ece93 fix(covers): consolidate legacy cover migration writes
- e8616e4e fix(covers): sanitize custom cover urls and preserve legacy cover migrations
- e57f6fde feat: refactor cover migration logic in AppComponent to improve error handling
- b5e30897 feat: implement legacy custom cover migration logic in GameShelfService
- b03ca6da feat: add test for applying selected image via custom cover path in game-list
- 1c977cce feat: support custom cover URLs in sync operations and repository handling

## v1.29.0 - 2026-03-26

- 82e8755d Merge pull request #285 from thetigeregg/feat/rtas
- afc5530c fix(game-list): avoid non-PTAS price preference recomputes
- e13cc77e feat: add price preference service and integrate into game filtering

## v1.30.0 - 2026-03-26

- 40c01e27 Merge pull request #284 from thetigeregg/feat/screenshots
- 1817be10 fix(media): reject unsafe image urls and prune detail payload cache
- 2cba6529 fix(game-detail): clear media slide preloader after image settles
- db67df17 Merge branch 'main' into feat/screenshots
- 2ee3d144 fix(game-detail): restrict media prefetch to same-origin urls
- b5ec4fac feat(image-url): add normalization for API base URL in proxy image URL builder
- e2b438ef fix(game-detail): share media URL policy and narrow slide prefetch
- f3d38a41 fix(game-detail): handle placeholder and credentialed media URLs
- e6f20b24 feat: enhance media slide loading logic and improve URL handling
- bba0dea9 feat: implement detail media loading and proxy handling for images

## v1.30.1 - 2026-03-26

- fffe6797 Merge pull request #286 from thetigeregg/feat/gameart
- 00fb0448 fix(service): update IGDB cover migration keys and platform IDs

## v1.30.2 - 2026-03-26

- 7c8f6848 Merge pull request #287 from thetigeregg/feat/bump
- 055d34d2 fix(services): update BehaviorSubject initialization to remove generic type annotations
- ea9df84d fix(dependencies): update @typescript-eslint packages to version 8.57.2
- f4105bf9 fix(dependencies): update eslint-plugin-jsdoc to version 62.8.1
- f9591a10 chore(deps): update dependencies for Angular, Capacitor, Tiptap, Swiper, and Vitest
- cd41153d fix(dependencies): update @angular/cdk to version 21.2.4
- c6a0c1b1 fix(dependencies): update Angular packages to version 21.2.6

## v1.30.3 - 2026-03-26

- 8d7eafd3 Merge pull request #288 from thetigeregg/feat/img
- 05fd9a5b fix(image-cache): enhance symlink handling in image proxy and cache management
- 459eda6d fix(api): harden managed image cache path handling
- 51728685 fix(api): recover from corrupt image cache paths
- b54205b9 fix(image-cache): improve file path handling and validation in image proxy
- a6665cbc test(image-proxy): add test for handling unreadable cached assets
- ed2e1ca2 fix(image-cache): enhance image proxy to handle truncated files and improve cache metrics

## v1.30.4 - 2026-03-26

- 8f6caa56 Merge pull request #289 from thetigeregg/feat/img
- 916e7d7d fix(ui): ignore stale detail media load events
- bb933e10 fix(ui): preserve relative backdrop retry urls
- 66e19a68 fix(ui): sync detail media backdrop when slide src changes
- a6e4527a Merge branch 'main' into feat/img
- 78f702aa fix(detail-media): enhance image loading with retry parameters and placeholder handling

## v1.31.0 - 2026-03-26

- f83c9df6 Merge pull request #290 from thetigeregg/feat/log
- eb111594 test(logging): add tests for handling enumerable getters that throw in single-line console
- bd9c9e66 fix(logging): reuse shared single-line console in server
- 4d5f79cc fix(scrapers): use explicit shared copy path in Dockerfiles
- 95e93b45 test(logging): add tests for handling proxy traps and large object truncation in single-line console
- d19e8e11 fix(logging): harden shared single-line console proxy handling
- b6b8d249 fix(logging): harden single-line console stringification
- 838ec9c1 fix(logging): harden single-line console normalization
- b437f9ad feat(logging): add tests for handling true cycles and prototype-named keys in single-line console
- c66fdb0b feat(logging): enhance single-line console to preserve non-finite numbers as strings
- d347dfea feat(logging): enhance single-line console to preserve string representations
- 9a17c426 fix(logging): narrow unknown values before object normalization
- 1d0d50aa feat(logging): update Dockerfiles and single-line console implementation
- cc0bb08d feat(logging): add tests for shared single-line console functionality and installation
- 183e757c feat(logging): refactor single line console logging implementation across multiple scrapers
- 6db0af52 feat(logging): enhance log structure with service and event attributes
- b30881cb fix(dependencies): remove unused packages from package.json and package-lock.json
- b15e4a38 feat(logging): implement single line console logging across multiple modules

## v1.31.1 - 2026-03-27

- e7b4f8c8 Merge pull request #291 from thetigeregg/dependabot/npm_and_yarn/server/multi-3e7317fefa
- 02713b93 chore(deps): bump brace-expansion and google-auth-library in /server

## v1.31.2 - 2026-03-27

- dadcfabf Merge pull request #292 from thetigeregg/dependabot/npm_and_yarn/server/node-forge-1.4.0
- 9c51f304 chore(deps): bump node-forge from 1.3.3 to 1.4.0 in /server

## v1.31.3 - 2026-03-30

- bd1cc60f Merge pull request #301 from thetigeregg/dependabot/github_actions/codecov/codecov-action-6
- 03e143b6 chore(ci): bump codecov/codecov-action from 5 to 6

## v1.31.4 - 2026-03-30

- b1fca4ef Merge pull request #302 from thetigeregg/feat/bump
- 1cb91635 Merge branch 'main' into feat/bump
- 0245965b chore(deps): update path-to-regexp to version 8.4.0 in server package-lock.json
- 56a33cb0 chore(deps): update dependencies to latest versions
- 235ecc86 chore(deps): bump @angular dependencies to version 21.2.5

## v1.32.0 - 2026-03-30

- f52e24be Merge pull request #303 from thetigeregg/feat/vpn
- 96fd0560 feat: enhance runtime availability service tests and add new runtime config checks
- e5a2af9a feat: enhance connection alert handling and add firebase config parsing
- d920bf88 feat: update tailnet references to service-unreachable for improved clarity
- 1f0f9dab feat: remove runtime status banner and implement tailnet alert handling
- 4a47bae1 feat: add runtime availability service and banner message for network status

## v1.32.1 - 2026-03-30

- 4a66f817 Merge pull request #295 from thetigeregg/dependabot/npm_and_yarn/server/typescript-6.0.2
- adb1f0e1 Merge branch 'main' into dependabot/npm_and_yarn/server/typescript-6.0.2
- 42895689 chore(deps): bump typescript from 5.9.3 to 6.0.2 in /server

## v1.33.0 - 2026-03-30

- f8fa98a8 Merge pull request #304 from thetigeregg/feat/detalink
- e90140bf Merge branch 'main' into feat/detalink
- 70855e66 feat: add unit tests for game detail metadata interactions and mock dependencies
- 0d70a1ae feat: enhance metadata filter functionality with new input and logic

## v1.34.0 - 2026-03-30

- de6b347b Merge pull request #305 from thetigeregg/feat/bump2
- 2d8fa511 fix(audit): pluralize success and error messages in runAudits
- d1710cd0 test(scripts): make audit command log assertion cross-platform
- 161b5634 Merge branch 'main' into feat/bump2
- a6b35a48 feat: replace audit-fix-all script with audit-all for improved functionality and add tests
- 9d7fb61a Merge branch 'main' into feat/bump2
- 17e26449 feat: streamline audit commands in package.json and improve audit script functionality
- 192f71f4 feat: update path-to-regexp to version 8.4.0 in multiple scrapers
- 5e51ddf4 feat: implement audit fix script for multiple projects

## v1.35.0 - 2026-03-30

- afe8a465 Merge pull request #306 from thetigeregg/feat/gflink
- b42cb434 fix(theme): harden dark palette token spec
- 4dbb9147 feat: update website item icons to use dark theme styles
- 8c485b0a feat: update theme variables with new color definitions and improve tests for dark palette
- 6fb13ee0 refactor: remove filled action surface colors and related tests
- 17626ab1 Merge branch 'main' into feat/gflink
- 10a2f14d feat: implement filled action surface colors and integrate with FAB components
- e116911d feat: add dark-palette contrast overrides and corresponding unit tests

## v1.36.0 - 2026-03-30

- 3c03bffe Merge pull request #308 from thetigeregg/feat/preload
- 46a9f3d2 feat: enhance explore page tests to include discovery pricing hydration checks
- 19a62c9b feat: improve recommendation loading by scheduling pricing hydration

## v1.37.0 - 2026-03-30

- 2361c36c Merge pull request #307 from thetigeregg/feat/xfer
- 9f6dba27 fix(data): validate enteredCollectionAt during v11 migration
- c17ba0a1 fix(settings): preserve imported timestamps during CSV import
- a5d5e026 fix(sync): normalize pulled list type before applying collection fallback
- dcc20082 fix(tests): clarify test descriptions and update modal close method
- 3bedffd3 fix(data): handle missing timestamps and improve sync behavior
- 9c97a829 fix(data): preserve collection timestamps on sync and catalog moves
- 246e1f62 fix(data): preserve collection timestamps across moves and sync
- 36abc2af Merge branch 'main' into feat/xfer
- faeb737a feat: optimize timestamp handling during game import and updates
- 0b7a0159 feat: enhance v11 upgrade tests to backfill and normalize enteredCollectionAt for collection rows
- 539b85b9 feat: support legacy CSV imports by backfilling enteredCollectionAt from createdAt
- d22f33fd Merge branch 'main' into feat/xfer
- 41d4d868 feat: remove move game functionality and related tests from explore and game detail components
- eac23295 feat: implement move game functionality between lists and add related tests
- 347306f3 feat: add enteredCollectionAt handling for game entries and update related tests

## v1.38.0 - 2026-03-30

- 796667c9 Merge pull request #309 from thetigeregg/feat/serve
- 32c2ba53 feat(handler): add error handling for malformed request URLs in createHandler
- 9582adf5 fix(dev): reject malformed PWA server port arguments
- db555d84 feat(sendFile): enhance error handling for file streaming and add corresponding tests
- 4a192af7 feat(tests): add tests for runPwa function handling various commands and edge cases
- 11886030 feat(proxy): enhance error handling in proxyRequest and add corresponding tests
- 3f2a2ffa feat(pwa): improve proxyRequest header handling and add ensureParentDirectories utility
- 5d229a76 feat(tests): enhance resolveSafePath tests for symlink escapes and add proxyRequest header filtering
- 1bf3c40c fix(dev): respect injected secrets env in worktree helper
- e81813c6 feat(env): enhance environment configuration for PWA and add reconciliation for manuals base URL
- 8d619f5c feat(server): add getDisplayHost function to handle host display logic and update server messages
- 34e09813 feat(proxy): handle response destruction on upstream errors after headers are sent
- 6ce50a1e feat(server): improve TCP port validation and update default host to localhost
- 1cd84ddf feat(proxy): enhance request validation and error handling for proxy requests
- 40f1a6c5 feat(server): enhance proxy origin validation and improve error handling
- 31a99643 feat(tests): add unit tests for pwa-https-server functions
- 8f024e83 fix(dev): resolve PWA serve PR review feedback
- 7683974c Merge branch 'main' into feat/serve
- 65265c68 feat: enhance PWA simulator certificate setup with mkcert commands and server
- 3fa2b4fa feat: enhance PWA simulator instructions for local HTTPS certificate setup
- e3aa15e8 feat: add PWA simulator support with HTTPS server and related scripts

## v1.39.0 - 2026-03-31

- 2331590f Merge pull request #310 from thetigeregg/feat/modal
- b139c0fa fix(fab): enable pointer events for detail shortcuts during transitions
- 10aa5df2 fix(app): re-prompt queued service worker updates
- b5c29fa5 fix(pwa): rename pending reload version API to reload marker
- 2eebe596 fix(app): handle update reload errors and clean up pwa listeners
- 79d4923b fix(app): persist seen version when update alert is skipped
- 9e9231ff fix(app): preserve pending reload prompts and catch alert effect failures
- bd4f77fc fix(app): activate waiting service worker before update reload
- 9ddd6bd4 feat(app): improve update alert handling and prevent duplicate alerts
- 811146ef fix(app): align PWA update prompts with service worker metadata
- 96273d24 feat(app): enhance PWA update handling and prevent duplicate alerts
- b75bac1d feat(pwa): add unit tests for PwaUpdateService functionality
- b16c4c81 feat(game-list): add entrance animation for detail shortcuts FAB
- 734d62ec feat(game-list): add visibility control for game detail FAB on modal presentation
- d328c906 refactor(global.scss): remove unused styles for detail shortcuts FAB
- 82396470 feat(pwa): implement PwaUpdateService for handling app updates and reloads
- 5a7a2c10 Merge branch 'main' into feat/modal
- 3e0dbb6a feat: replace DetailShortcutsFab component with ion-fab for improved UI consistency
- 607db0fc Merge branch 'main' into feat/modal
- 038545e9 feat(detail-shortcuts-fab): add fixed slot attribute and update tests

## v1.39.1 - 2026-04-02

- 1f5480f7 Merge pull request #312 from thetigeregg/feat/fix
- 491b98da fix(dependencies): update playwright to version 1.59.1
- ddfae51a chore: update dependencies to latest versions
- 739aa582 fix(dependencies): update @angular/cdk to version 21.2.5
- c1443e6e fix(dependencies): update Angular packages to version 21.2.7

## v1.40.0 - 2026-04-03

- 9116a15e Merge pull request #313 from thetigeregg/feat/split
- 92a1d99c feat: update release workflow to use npm exec for version bump
- 56cb672b Merge branch 'main' into feat/split
- 6b2c9b06 feat: remove pre-PR automated code cleanup prompt
- 8dc601db feat: add initial configuration for game-shelf project
- d2a2a3e9 feat: refactor worktree-dev script to utilize context and improve structure
- b48eb263 feat: migrate configuration files to use shared packages
- a4a2d7f3 feat: add npm dependency installation step in release workflow
- aadf9efc feat: update dependencies and improve dev scripts
- 6dba8f97 feat: remove deprecated scripts

## v1.40.1 - 2026-04-06

- 9f93107b Merge pull request #314 from thetigeregg/bump2
- 8edd191f chore: update @tiptap packages to version 3.22.2 and bump dotenv to 17.4.1
- 778d1cc6 fix(lint): ignore local worktrees in eslint
- 4277592f chore: update packages

## v1.40.2 - 2026-04-06

- 312274de Merge pull request #323 from thetigeregg/feat/bump
- e0f4cea5 chore: update Playwright version to v1.59.1 in Dockerfiles

## v1.40.3 - 2026-04-07

- 900a6b4c Merge pull request #324 from thetigeregg/feat/cursor
- 7f68afa9 fix: update .cursor/rules/pr-review.mdc
- 380d16cf fix: update .cursor/rules/commits.mdc
- cd025b24 chore: simplify pr:review script in package.json by removing VS Code auto-open functionality
- c4201172 chore: rename pr:summary script to pr:review in package.json
- c50a2e1a chore: update pre-commit verification steps in workflow.mdc to include build check
- 2d1d9eb6 chore: add pre-commit verification guidelines to workflow.mdc
- bfdd478b chore: remove AI agent instructions document
- 64463b9a chore: update configuration to rename summary output file to review output file
- 5821d5fe chore: rename .pr-summary-prompt.md to .pr-review-prompt.md in .gitignore
- 31f359c8 chore: add code quality and commit message guidelines, update husky scripts
- 1ff177e6 chore(deps): update dependencies
