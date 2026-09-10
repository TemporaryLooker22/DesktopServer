#if defined(__x86_64__)
__attribute__((naked, visibility("default")))
void ____chkstk_darwin(void) __asm__("____chkstk_darwin");
void ____chkstk_darwin(void) {
    __asm__ volatile (
        "pushq   %%rcx\n\t"
        "pushq   %%rax\n\t"
        "cmpq    $0x1000, %%rax\n\t"
        "jb      1f\n\t"
        "movq    %%rsp, %%rcx\n\t"
        "addq    $16, %%rcx\n\t"
        "2:\n\t"
        "subq    $0x1000, %%rcx\n\t"
        "testq   %%rax, (%%rcx)\n\t"
        "subq    $0x1000, %%rax\n\t"
        "cmpq    $0x1000, %%rax\n\t"
        "jae     2b\n\t"
        "1:\n\t"
        "popq    %%rax\n\t"
        "popq    %%rcx\n\t"
        "retq\n\t"
    );
}

__attribute__((naked, visibility("default")))
void ___chkstk_darwin(void) __asm__("___chkstk_darwin");
void ___chkstk_darwin(void) {
    ____chkstk_darwin();
}
#elif defined(__arm64__) || defined(__aarch64__)
__attribute__((visibility("default")))
void ____chkstk_darwin(void) __asm__("____chkstk_darwin");
void ____chkstk_darwin(void) {}

__attribute__((visibility("default")))
void ___chkstk_darwin(void) __asm__("___chkstk_darwin");
void ___chkstk_darwin(void) {}
#endif
