#include <stdio.h>
#include <stdlib.h>
#include <string.h>

double do_convert(int64_t input)
{
    uint64_t sign = (input < 0);
    uint64_t magnitude;

    // breaks on INT64_MIN
    if (sign)
        magnitude = -input;
    else
        magnitude = input;    

    // use your favourite algorithm here instead of the builtin
    int leading_zeros = __builtin_clzl(magnitude);
    uint64_t exponent = (63 - leading_zeros) + 1023;
    uint64_t significand = (magnitude << (leading_zeros + 1)) >> 12;

    uint64_t fake_double = sign << 63
                         | exponent << 52
                         | significand;

    double d;
    memcpy(&d, &fake_double, sizeof d);

    return d;
}

int main(int argc, char** argv)
{
    for (int i = 1; i < argc; i++)
    {
        long l = strtol(argv[i], NULL, 0);
        double d = do_convert(l);
        printf("%ld %f\n", l, d);
    }

    return 0;
}
