/*
 * libchkstk.dylib - macOS 10.13 High Sierra Compatibility Shim
 *
 * Provides Objective-C runtime optimization functions introduced in macOS 10.14.4 / 10.15
 * for modern OpenJDK / Liberica 25 libjava.dylib running on macOS 10.13.
 */

#include <stddef.h>

/* Objective-C runtime basic types */
typedef void* id;
typedef void* SEL;
typedef void* Class;
typedef signed char BOOL;

#define YES ((BOOL)1)
#define NO  ((BOOL)0)
#define nil ((id)0)

extern id objc_msgSend(id self, SEL op, ...);
extern SEL sel_registerName(const char *str);

/*
 * objc_alloc_init (introduced in macOS 10.14.4)
 * Executes [[cls alloc] init] via standard objc_msgSend
 */
__attribute__((visibility("default")))
id objc_alloc_init(Class cls) {
    if (!cls) return nil;
    static SEL s_alloc = NULL;
    static SEL s_init = NULL;
    if (!s_alloc) s_alloc = sel_registerName("alloc");
    if (!s_init) s_init = sel_registerName("init");

    id obj = ((id (*)(id, SEL))objc_msgSend)((id)cls, s_alloc);
    if (!obj) return nil;
    return ((id (*)(id, SEL))objc_msgSend)(obj, s_init);
}

/*
 * objc_alloc (introduced in macOS 10.14.4)
 * Executes [cls alloc] via standard objc_msgSend
 */
__attribute__((visibility("default")))
id objc_alloc(Class cls) {
    if (!cls) return nil;
    static SEL s_alloc = NULL;
    if (!s_alloc) s_alloc = sel_registerName("alloc");
    return ((id (*)(id, SEL))objc_msgSend)((id)cls, s_alloc);
}

/*
 * objc_opt_self (introduced in macOS 10.15)
 * Fast class identity / self verification
 */
__attribute__((visibility("default")))
id objc_opt_self(id self) {
    return self;
}

/*
 * objc_opt_new (introduced in macOS 10.15)
 * Executes [cls new] via standard objc_msgSend
 */
__attribute__((visibility("default")))
id objc_opt_new(Class cls) {
    if (!cls) return nil;
    static SEL s_new = NULL;
    if (!s_new) s_new = sel_registerName("new");
    return ((id (*)(id, SEL))objc_msgSend)((id)cls, s_new);
}

/*
 * objc_opt_isKindOfClass (introduced in macOS 10.15)
 * Executes [self isKindOfClass:cls] via standard objc_msgSend
 */
__attribute__((visibility("default")))
BOOL objc_opt_isKindOfClass(id self, Class cls) {
    if (!self || !cls) return NO;
    static SEL s_isKindOfClass = NULL;
    if (!s_isKindOfClass) s_isKindOfClass = sel_registerName("isKindOfClass:");
    return ((BOOL (*)(id, SEL, Class))objc_msgSend)(self, s_isKindOfClass, cls);
}

/*
 * objc_opt_respondsToSelector (introduced in macOS 10.15)
 * Executes [self respondsToSelector:sel] via standard objc_msgSend
 */
__attribute__((visibility("default")))
BOOL objc_opt_respondsToSelector(id self, SEL sel) {
    if (!self || !sel) return NO;
    static SEL s_responds = NULL;
    if (!s_responds) s_responds = sel_registerName("respondsToSelector:");
    return ((BOOL (*)(id, SEL, SEL))objc_msgSend)(self, s_responds, sel);
}

