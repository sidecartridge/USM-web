# LZSS C harness

One-shot tool that captures the upstream `lzss_compress` output bytes so
the JS port in `src/lzss.js` can be diff-tested for byte-parity.

`lzcompress.c` is a verbatim snapshot of `lzss_compress` from
`atarist-USM/usm.c`. If upstream changes that function, snapshot the new
version here, rebuild, regenerate every `tests/fixtures/lzss/*.lz`, and
commit the change to the harness together with the new `.lz` files.

## Build

```sh
gcc -O2 lzcompress.c -o lzcompress
```

The binary is not committed (per `.gitignore` for `lzcompress`).

## Regenerate a fixture

```sh
./lzcompress ../fixtures/hello.prg > ../fixtures/lzss/hello.lz
```

## When to run

Only when the upstream `lzss_compress` changes. The JS encoder is tested
against the committed `.lz` files; you do not need to run the harness on
every test.
