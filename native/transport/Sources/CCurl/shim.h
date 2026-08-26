#ifndef SUBTANDEM_CCURL_SHIM_H
#define SUBTANDEM_CCURL_SHIM_H

#include <curl/curl.h>

static inline CURLcode sl_curl_setopt_long(CURL *handle, CURLoption option, long value) {
  return curl_easy_setopt(handle, option, value);
}

static inline CURLcode sl_curl_setopt_offset(CURL *handle, CURLoption option, curl_off_t value) {
  return curl_easy_setopt(handle, option, value);
}

static inline CURLcode sl_curl_setopt_string(CURL *handle, CURLoption option, const char *value) {
  return curl_easy_setopt(handle, option, value);
}

static inline CURLcode sl_curl_setopt_pointer(CURL *handle, CURLoption option, void *value) {
  return curl_easy_setopt(handle, option, value);
}

static inline CURLcode sl_curl_setopt_headers(CURL *handle, struct curl_slist *headers) {
  return curl_easy_setopt(handle, CURLOPT_HTTPHEADER, headers);
}

static inline CURLcode sl_curl_setopt_write_callback(
    CURL *handle,
    size_t (*callback)(char *, size_t, size_t, void *)) {
  return curl_easy_setopt(handle, CURLOPT_WRITEFUNCTION, callback);
}

static inline CURLcode sl_curl_setopt_header_callback(
    CURL *handle,
    size_t (*callback)(char *, size_t, size_t, void *)) {
  return curl_easy_setopt(handle, CURLOPT_HEADERFUNCTION, callback);
}

static inline CURLcode sl_curl_setopt_progress_callback(
    CURL *handle,
    int (*callback)(void *, curl_off_t, curl_off_t, curl_off_t, curl_off_t)) {
  return curl_easy_setopt(handle, CURLOPT_XFERINFOFUNCTION, callback);
}

static inline CURLcode sl_curl_get_response_code(CURL *handle, long *value) {
  return curl_easy_getinfo(handle, CURLINFO_RESPONSE_CODE, value);
}

#endif
