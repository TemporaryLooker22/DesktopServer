.text
#if defined(__x86_64__)
.globl _____chkstk_darwin
.globl ____chkstk_darwin
.globl ___chkstk_darwin
.globl __chkstk_darwin
_____chkstk_darwin:
____chkstk_darwin:
___chkstk_darwin:
__chkstk_darwin:
    retq
#elif defined(__arm64__) || defined(__aarch64__)
.globl _____chkstk_darwin
.globl ____chkstk_darwin
.globl ___chkstk_darwin
.globl __chkstk_darwin
_____chkstk_darwin:
____chkstk_darwin:
___chkstk_darwin:
__chkstk_darwin:
    ret
#endif
