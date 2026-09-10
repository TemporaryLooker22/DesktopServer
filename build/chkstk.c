#if defined(__x86_64__)
__attribute__((naked, visibility("default")))
void _____chkstk_darwin(void) __asm__("_____chkstk_darwin");
void _____chkstk_darwin(void) { __asm__ volatile ("retq"); }

__attribute__((naked, visibility("default")))
void ____chkstk_darwin(void) __asm__("____chkstk_darwin");
void ____chkstk_darwin(void) { __asm__ volatile ("retq"); }

__attribute__((naked, visibility("default")))
void ___chkstk_darwin(void) __asm__("___chkstk_darwin");
void ___chkstk_darwin(void) { __asm__ volatile ("retq"); }

__attribute__((naked, visibility("default")))
void __chkstk_darwin(void) __asm__("__chkstk_darwin");
void __chkstk_darwin(void) { __asm__ volatile ("retq"); }
#elif defined(__arm64__) || defined(__aarch64__)
__attribute__((visibility("default")))
void _____chkstk_darwin(void) __asm__("_____chkstk_darwin");
void _____chkstk_darwin(void) {}

__attribute__((visibility("default")))
void ____chkstk_darwin(void) __asm__("____chkstk_darwin");
void ____chkstk_darwin(void) {}

__attribute__((visibility("default")))
void ___chkstk_darwin(void) __asm__("___chkstk_darwin");
void ___chkstk_darwin(void) {}

__attribute__((visibility("default")))
void __chkstk_darwin(void) __asm__("__chkstk_darwin");
void __chkstk_darwin(void) {}
#endif
