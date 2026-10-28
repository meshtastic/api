# Attribution

`nrf_erase2.uf2`, `nrf_erase_sd7_3.uf2`, and `pico_erase.uf2` are compiled output from
[meshtastic/nrf52_factory_erase](https://github.com/meshtastic/nrf52_factory_erase)
(GPL-3.0-only), vendored here rather than fetched at runtime because that repo cuts no GitHub
releases. Digests are pinned in `../../data/maintenanceUf2.json` and re-verified by
`scripts/validate-maintenance-uf2.ts`.

`meshtastic_factory_erase.uf2` is `tools/meshtastic_factory_erase.uf2` from
[meshtastic/nRF52_Bootloader](https://github.com/meshtastic/nRF52_Bootloader)
(MIT) at commit
[`c8ccd1d7419fda4c01c30c8a9bf144d30a424c46`](https://github.com/meshtastic/nRF52_Bootloader/blob/c8ccd1d7419fda4c01c30c8a9bf144d30a424c46/tools/meshtastic_factory_erase.uf2),
generated there by `tools/make_factory_erase_uf2.py` and shipped as the `meshtastic_factory_erase.uf2`
asset of release [`0.9.2-OTAFIX2.4`](https://github.com/meshtastic/nRF52_Bootloader/releases/tag/0.9.2-OTAFIX2.4)
(same bytes, same digest). Same digest pinning and re-verification as above.
