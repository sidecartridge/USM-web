/* One-shot harness: read a file, write LZSS-12-4 compressed bytes to stdout.
 *
 * The lzss_compress function below is a verbatim snapshot of the same
 * function in atarist-USM/usm.c. Updating it means: copy the new version
 * verbatim, rebuild this harness, regenerate every fixture under
 * tests/fixtures/lzss/, commit them together with the harness change.
 * The JS port in USM-web/src/lzss.js must match this C function
 * byte-for-byte.
 *
 * Build:   gcc -O2 lzcompress.c -o lzcompress
 * Usage:   ./lzcompress <input-file>  >  <output.lz>
 */

#include <stdio.h>
#include <stdlib.h>
#include <stdint.h>
#include <stddef.h>

#define LZSS_OFF_BITS    12
#define LZSS_LEN_BITS    4
#define LZSS_WIN_SIZE    (1 << LZSS_OFF_BITS)          /* 4096 */
#define LZSS_MIN_MATCH   3
#define LZSS_MAX_MATCH   (LZSS_MIN_MATCH + (1 << LZSS_LEN_BITS) - 1) /* 18 */

static int lzss_compress(const unsigned char *src, size_t srclen,
                         unsigned char *dst, size_t dstcap,
                         size_t *out_len)
{
    size_t in = 0;
    size_t out = 0;
    while (in < srclen)
    {
        if (out >= dstcap) return -1;
        size_t flag_pos = out++;
        unsigned char flag = 0;

        for (int bit = 0; bit < 8 && in < srclen; bit++)
        {
            size_t window_start = (in > LZSS_WIN_SIZE) ? in - LZSS_WIN_SIZE : 0;
            size_t best_off = 0;
            size_t best_len = 0;
            size_t max_l    = LZSS_MAX_MATCH;
            if (in + max_l > srclen) max_l = srclen - in;

            for (size_t j = in; j > window_start; )
            {
                j--;
                size_t l = 0;
                while (l < max_l && src[j + l] == src[in + l]) l++;
                if (l > best_len)
                {
                    best_len = l;
                    best_off = in - j;
                    if (best_len == LZSS_MAX_MATCH) break;
                }
            }

            if (best_len >= LZSS_MIN_MATCH)
            {
                if (out + 2 > dstcap) return -1;
                uint32_t enc_off = (uint32_t)(best_off - 1);
                uint32_t enc_len = (uint32_t)(best_len - LZSS_MIN_MATCH);
                uint32_t word = (enc_off << LZSS_LEN_BITS) | enc_len;
                dst[out++] = (unsigned char)(word >> 8);
                dst[out++] = (unsigned char)(word & 0xff);
                flag |= (unsigned char)(1 << (7 - bit));
                in += best_len;
            }
            else
            {
                if (out + 1 > dstcap) return -1;
                dst[out++] = src[in++];
            }
        }

        dst[flag_pos] = flag;
    }

    *out_len = out;
    return 0;
}

int main(int argc, char **argv)
{
    if (argc != 2)
    {
        fprintf(stderr, "usage: %s <input-file> > <output.lz>\n", argv[0]);
        return 2;
    }
    FILE *fp = fopen(argv[1], "rb");
    if (!fp) { perror(argv[1]); return 1; }
    fseek(fp, 0, SEEK_END);
    long sz = ftell(fp);
    fseek(fp, 0, SEEK_SET);
    if (sz < 0) { fclose(fp); fprintf(stderr, "ftell failed\n"); return 1; }
    unsigned char *src = (unsigned char *)malloc((size_t)sz);
    size_t cap = (size_t)sz * 2 + 64;
    unsigned char *dst = (unsigned char *)malloc(cap);
    if (!src || !dst) { fclose(fp); fprintf(stderr, "oom\n"); return 1; }
    if (fread(src, 1, (size_t)sz, fp) != (size_t)sz)
    { fclose(fp); fprintf(stderr, "read failed\n"); return 1; }
    fclose(fp);

    size_t out_len = 0;
    if (lzss_compress(src, (size_t)sz, dst, cap, &out_len) != 0)
    { fprintf(stderr, "compress failed\n"); return 1; }

    if (fwrite(dst, 1, out_len, stdout) != out_len)
    { fprintf(stderr, "write failed\n"); return 1; }

    free(src);
    free(dst);
    return 0;
}
