# Issues

Problems found while building the reflex client: gaps in reflex, mismatches with the t3code server, and anything that pushes towards a server change.

## Setup: `vp` does not select the pinned Node on this machine

The repo pins Node 26.12.1 and the server needs 24.10 or later, but `vp` stays in `system_first` mode and runs the system Node (24.4.1). `vp env exec --node 26.12.1` also ran 24.4.1. `vp env on` would fix it, but it changes the machine-wide mode, which other projects share.

Workaround: use Node 26.13.0 through nvm. The pin in `package.json` isn't enforced, and `vp i` and `vp run dev` work on it.
