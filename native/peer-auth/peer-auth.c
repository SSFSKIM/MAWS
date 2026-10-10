// Peer identity for a Unix-domain socket on macOS, for MAWS's per-session browser socket and cua's client-mode relay
// (cua docs/doperpowers/specs/2026-10-09-maws-socket-peer-auth-design.md). Three system calls and nothing else; the
// policy (who is accepted) lives in each repository's loader. This file is byte-identical in the two repositories.
//
//   peer(fd)      getsockopt(fd, SOL_LOCAL, LOCAL_PEERPID) and getpeereid(fd) -> { pid, uid }; throws on failure.
//                 LOCAL_PEERPID names the process that last operated on the peer socket, not necessarily the one that
//                 connected: a caller re-reads it after deciding.
//   process(pid)  proc_pidinfo(pid, PROC_PIDTBSDINFO) -> { ppid, start } with start in microseconds since the epoch
//                 (pbi_start_tvsec * 1e6 + pbi_start_tvusec); null when the process is gone or unreadable.
//   version       bumped whenever an export's shape or meaning changes; each loader pins it.
//
// Built by scripts/build-peer-auth.sh against the N-API headers (node-api-headers), NAPI_VERSION 8, so one prebuild
// loads under Electron's Node and under plain Node alike.
#define NAPI_VERSION 8
#include <node_api.h>

#include <errno.h>
#include <libproc.h>
#include <stdio.h>
#include <string.h>
#include <sys/proc_info.h>
#include <sys/socket.h>
#include <sys/types.h>
#include <sys/un.h>
#include <unistd.h>

#define PEER_AUTH_VERSION 1

static napi_value throw_errno(napi_env env, const char *call, int code) {
  char message[128];
  snprintf(message, sizeof message, "%s: %s", call, strerror(code));
  napi_throw_error(env, NULL, message);
  return NULL;
}

// The single integer argument of peer() and process(); throws a TypeError otherwise.
static int int_arg(napi_env env, napi_callback_info info, int32_t *out) {
  size_t argc = 1;
  napi_value argv[1];
  napi_valuetype type;
  if (napi_get_cb_info(env, info, &argc, argv, NULL, NULL) != napi_ok) return 0;
  if (argc < 1 || napi_typeof(env, argv[0], &type) != napi_ok || type != napi_number ||
      napi_get_value_int32(env, argv[0], out) != napi_ok) {
    napi_throw_type_error(env, NULL, "expected a number");
    return 0;
  }
  return 1;
}

static int set_number(napi_env env, napi_value object, const char *name, double value) {
  napi_value number;
  return napi_create_double(env, value, &number) == napi_ok && napi_set_named_property(env, object, name, number) == napi_ok;
}

static napi_value peer(napi_env env, napi_callback_info info) {
  int32_t fd;
  if (!int_arg(env, info, &fd)) return NULL;
  pid_t pid = 0;
  socklen_t length = sizeof pid;
  if (getsockopt(fd, SOL_LOCAL, LOCAL_PEERPID, &pid, &length) != 0) return throw_errno(env, "getsockopt(LOCAL_PEERPID)", errno);
  uid_t uid;
  gid_t gid;
  if (getpeereid(fd, &uid, &gid) != 0) return throw_errno(env, "getpeereid", errno);
  napi_value result;
  if (napi_create_object(env, &result) != napi_ok || !set_number(env, result, "pid", (double)pid) ||
      !set_number(env, result, "uid", (double)uid))
    return NULL;
  return result;
}

static napi_value process_info(napi_env env, napi_callback_info info) {
  int32_t pid;
  if (!int_arg(env, info, &pid)) return NULL;
  struct proc_bsdinfo bsd;
  napi_value result;
  if (pid < 0 || proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, &bsd, PROC_PIDTBSDINFO_SIZE) != PROC_PIDTBSDINFO_SIZE) {
    if (napi_get_null(env, &result) != napi_ok) return NULL;
    return result;
  }
  double start = (double)bsd.pbi_start_tvsec * 1e6 + (double)bsd.pbi_start_tvusec;
  if (napi_create_object(env, &result) != napi_ok || !set_number(env, result, "ppid", (double)bsd.pbi_ppid) ||
      !set_number(env, result, "start", start))
    return NULL;
  return result;
}

static int export_function(napi_env env, napi_value exports, const char *name, napi_callback callback) {
  napi_value fn;
  return napi_create_function(env, name, NAPI_AUTO_LENGTH, callback, NULL, &fn) == napi_ok &&
         napi_set_named_property(env, exports, name, fn) == napi_ok;
}

NAPI_MODULE_INIT() {
  napi_value version;
  if (!export_function(env, exports, "peer", peer) || !export_function(env, exports, "process", process_info) ||
      napi_create_int32(env, PEER_AUTH_VERSION, &version) != napi_ok ||
      napi_set_named_property(env, exports, "version", version) != napi_ok)
    return NULL;
  return exports;
}
