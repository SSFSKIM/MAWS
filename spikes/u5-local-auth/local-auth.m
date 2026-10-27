// U5's second candidate (P5-O10 M9, docs/doperpowers/plans/2026-10-27-p5-o10-endpoint.md): a Node-API addon on
// LocalAuthentication's LAContext with the device-owner policy (Touch ID, a paired Watch, or the login password), built
// like native/peer-auth/ (NAPI_VERSION 8, so one build loads under Electron's Node and plain Node). Spike code: if it
// wins U5, it moves to native/local-auth/ with a committed prebuild and a loader in main.
//
//   canEvaluate()       -> { ok, biometryType, code?, domain?, message? }    canEvaluatePolicy: shows no UI
//   evaluate(reason)    -> Promise<{ ok, code?, domain?, message?, ms }>     evaluatePolicy: shows the system prompt
//   version
//
// evaluate() runs on a libuv worker thread that waits on the reply block, so the JavaScript thread never blocks, and
// resolves (never rejects) with LAError's code on a failure: -2 user cancel, -3 user fallback, -4 system cancel,
// -5 passcode not set, -6 biometry not available, -7 not enrolled, -8 lockout, -1 authentication failed, -1004 not
// interactive.
#define NAPI_VERSION 8
#include <node_api.h>

#import <Foundation/Foundation.h>
#import <LocalAuthentication/LocalAuthentication.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

#define LOCAL_AUTH_VERSION 1
static const LAPolicy POLICY = LAPolicyDeviceOwnerAuthentication;

typedef struct {
  napi_async_work work;
  napi_deferred deferred;
  char *reason;
  int ok;
  long code;
  char domain[128];
  char message[512];
  double ms;
} Evaluation;

static double now_ms(void) {
  struct timespec t;
  clock_gettime(CLOCK_MONOTONIC, &t);
  return t.tv_sec * 1e3 + t.tv_nsec / 1e6;
}

static void copy_error(NSError *error, long *code, char *domain, size_t domain_size, char *message, size_t message_size) {
  *code = error ? (long)error.code : 0;
  snprintf(domain, domain_size, "%s", error ? error.domain.UTF8String : "");
  snprintf(message, message_size, "%s", error ? error.localizedDescription.UTF8String : "");
}

static int set_value(napi_env env, napi_value object, const char *name, napi_value value) {
  return napi_set_named_property(env, object, name, value) == napi_ok;
}
static int set_bool(napi_env env, napi_value object, const char *name, int value) {
  napi_value out;
  return napi_get_boolean(env, value, &out) == napi_ok && set_value(env, object, name, out);
}
static int set_number(napi_env env, napi_value object, const char *name, double value) {
  napi_value out;
  return napi_create_double(env, value, &out) == napi_ok && set_value(env, object, name, out);
}
static int set_string(napi_env env, napi_value object, const char *name, const char *value) {
  napi_value out;
  return napi_create_string_utf8(env, value, NAPI_AUTO_LENGTH, &out) == napi_ok && set_value(env, object, name, out);
}

static const char *biometry_name(LABiometryType type) {
  switch (type) {
    case LABiometryTypeTouchID: return "touch-id";
    case LABiometryTypeFaceID: return "face-id";
    case LABiometryTypeNone: return "none";
    default: return "other";
  }
}

static napi_value can_evaluate(napi_env env, napi_callback_info info) {
  (void)info;
  @autoreleasepool {
    LAContext *context = [[LAContext alloc] init];
    NSError *error = nil;
    BOOL ok = [context canEvaluatePolicy:POLICY error:&error];
    long code;
    char domain[128], message[512];
    copy_error(error, &code, domain, sizeof domain, message, sizeof message);
    napi_value result;
    if (napi_create_object(env, &result) != napi_ok) return NULL;
    set_bool(env, result, "ok", ok);
    set_string(env, result, "biometryType", biometry_name(context.biometryType));
    if (!ok) {
      set_number(env, result, "code", (double)code);
      set_string(env, result, "domain", domain);
      set_string(env, result, "message", message);
    }
    return result;
  }
}

static void evaluate_execute(napi_env env, void *data) {
  (void)env;
  Evaluation *e = data;
  @autoreleasepool {
    LAContext *context = [[LAContext alloc] init];
    NSString *reason = [NSString stringWithUTF8String:e->reason];
    dispatch_semaphore_t done = dispatch_semaphore_create(0);
    __block BOOL ok = NO;
    __block NSError *failure = nil;
    double started = now_ms();
    [context evaluatePolicy:POLICY
            localizedReason:reason
                      reply:^(BOOL success, NSError *error) {
                        ok = success;
                        failure = error;
                        dispatch_semaphore_signal(done);
                      }];
    dispatch_semaphore_wait(done, DISPATCH_TIME_FOREVER);
    e->ms = now_ms() - started;
    e->ok = ok;
    copy_error(failure, &e->code, e->domain, sizeof e->domain, e->message, sizeof e->message);
  }
}

static void evaluate_complete(napi_env env, napi_status status, void *data) {
  Evaluation *e = data;
  napi_value result;
  napi_create_object(env, &result);
  set_bool(env, result, "ok", status == napi_ok && e->ok);
  set_number(env, result, "ms", e->ms);
  if (!(status == napi_ok && e->ok)) {
    set_number(env, result, "code", (double)e->code);
    set_string(env, result, "domain", e->domain);
    set_string(env, result, "message", e->message);
  }
  napi_resolve_deferred(env, e->deferred, result);
  napi_delete_async_work(env, e->work);
  free(e->reason);
  free(e);
}

static napi_value evaluate(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  napi_valuetype type;
  size_t length;
  if (napi_get_cb_info(env, info, &argc, argv, NULL, NULL) != napi_ok) return NULL;
  if (argc < 1 || napi_typeof(env, argv[0], &type) != napi_ok || type != napi_string ||
      napi_get_value_string_utf8(env, argv[0], NULL, 0, &length) != napi_ok || length == 0) {
    napi_throw_type_error(env, NULL, "expected a non-empty reason");
    return NULL;
  }
  Evaluation *e = calloc(1, sizeof *e);
  e->reason = malloc(length + 1);
  napi_get_value_string_utf8(env, argv[0], e->reason, length + 1, &length);
  napi_value promise, name;
  napi_create_promise(env, &e->deferred, &promise);
  napi_create_string_utf8(env, "local-auth.evaluate", NAPI_AUTO_LENGTH, &name);
  napi_create_async_work(env, NULL, name, evaluate_execute, evaluate_complete, e, &e->work);
  napi_queue_async_work(env, e->work);
  return promise;
}

static napi_value init(napi_env env, napi_value exports) {
  napi_value fn, version;
  napi_create_function(env, "canEvaluate", NAPI_AUTO_LENGTH, can_evaluate, NULL, &fn);
  napi_set_named_property(env, exports, "canEvaluate", fn);
  napi_create_function(env, "evaluate", NAPI_AUTO_LENGTH, evaluate, NULL, &fn);
  napi_set_named_property(env, exports, "evaluate", fn);
  napi_create_int32(env, LOCAL_AUTH_VERSION, &version);
  napi_set_named_property(env, exports, "version", version);
  return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, init)
