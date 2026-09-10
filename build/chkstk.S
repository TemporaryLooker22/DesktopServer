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
    pushq   %rcx
    pushq   %rax
    cmpq    $0x1000, %rax
    jb      1f
    movq    %rsp, %rcx
    addq    $16, %rcx
2:
    subq    $0x1000, %rcx
    testq   %rax, (%rcx)
    subq    $0x1000, %rax
    cmpq    $0x1000, %rax
    jae     2b
1:
    popq    %rax
    popq    %rcx
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
