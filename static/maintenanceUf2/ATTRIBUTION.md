# Attribution

`nrf_erase2.uf2`, `nrf_erase_sd7_3.uf2`, and `pico_erase.uf2` are compiled output from
[meshtastic/nrf52_factory_erase](https://github.com/meshtastic/nrf52_factory_erase)
(GPL-3.0-only), vendored here rather than fetched at runtime because that repo cuts no GitHub
releases. Digests are pinned in `../../data/maintenanceUf2.json` and re-verified by
`scripts/validate-maintenance-uf2.ts`.
