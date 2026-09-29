package it.agentbridge.app;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.CookieHandler;
import java.net.HttpCookie;
import java.net.CookieManager;
import java.net.CookiePolicy;
import java.net.HttpURLConnection;
import java.net.URI;
import java.net.URL;
import java.nio.charset.StandardCharsets;

final class ApiClient {
    private static final String SESSION_COOKIE = "__Host-ab_session";
    private String baseUrl;
    private String csrf;
    private final CookieManager cookieManager;
    private final SharedPreferences preferences;

    ApiClient(Context context, String baseUrl) {
        preferences = context.getSharedPreferences("agent_bridge_auth", Context.MODE_PRIVATE);
        cookieManager = new CookieManager(null, CookiePolicy.ACCEPT_ALL);
        CookieHandler.setDefault(cookieManager);
        setBaseUrl(baseUrl);
    }

    void setBaseUrl(String value) {
        String clean = value == null ? "" : value.trim();
        while (clean.endsWith("/")) clean = clean.substring(0, clean.length() - 1);
        baseUrl = clean;
        csrf = null;
        cookieManager.getCookieStore().removeAll();
        restoreSessionCookie();
    }

    JSONObject me() throws Exception {
        JSONObject result = request("api/me", "GET", null, null, 30_000);
        csrf = result.optString("csrf", null);
        return result;
    }

    JSONObject login(String password, String code) throws Exception {
        JSONObject body = new JSONObject().put("password", password).put("code", code);
        JSONObject result = request("api/login", "POST", body.toString().getBytes(StandardCharsets.UTF_8), "application/json", 30_000);
        csrf = result.optString("csrf", null);
        return me();
    }

    void logout() throws Exception {
        try {
            request("api/logout", "POST", "{}".getBytes(StandardCharsets.UTF_8), "application/json", 30_000);
        } finally {
            clearSession();
        }
    }

    JSONObject startJob(JSONObject body) throws Exception {
        return request("api/jobs", "POST", body.toString().getBytes(StandardCharsets.UTF_8), "application/json", 30_000)
                .getJSONObject("job");
    }

    JSONObject job(String id) throws Exception {
        return request("api/jobs/" + id, "GET", null, null, 30_000);
    }

    String transcribe(byte[] audio) throws Exception {
        return request("api/transcribe?lang=it", "POST", audio, "audio/mp4", 100_000).optString("text");
    }

    private JSONObject request(String path, String method, byte[] body, String contentType, int timeout) throws Exception {
        if (baseUrl.isEmpty() || !baseUrl.startsWith("https://")) {
            throw new IOException("Inserisci un indirizzo server HTTPS valido.");
        }
        HttpURLConnection connection = (HttpURLConnection) new URL(baseUrl + "/" + path).openConnection();
        connection.setRequestMethod(method);
        connection.setConnectTimeout(15_000);
        connection.setReadTimeout(timeout);
        connection.setRequestProperty("Accept", "application/json");
        connection.setRequestProperty("User-Agent", "AgentBridge-Android/1.1");
        if (!"GET".equals(method)) {
            URI uri = URI.create(baseUrl);
            String origin = uri.getScheme() + "://" + uri.getAuthority();
            connection.setRequestProperty("Origin", origin);
            if (csrf != null && !csrf.isEmpty()) connection.setRequestProperty("X-CSRF-Token", csrf);
        }
        if (body != null) {
            connection.setDoOutput(true);
            connection.setFixedLengthStreamingMode(body.length);
            connection.setRequestProperty("Content-Type", contentType);
            try (OutputStream output = connection.getOutputStream()) {
                output.write(body);
            }
        }

        int code = connection.getResponseCode();
        // Persist the HttpOnly session value inside this app's private sandbox so
        // reopening Android does not unnecessarily ask for password + 2FA again.
        cookieManager.put(connection.getURL().toURI(), connection.getHeaderFields());
        persistSessionCookie();
        InputStream stream = code >= 200 && code < 300 ? connection.getInputStream() : connection.getErrorStream();
        String text = stream == null ? "" : new String(readAll(stream), StandardCharsets.UTF_8);
        connection.disconnect();
        JSONObject json = text.isEmpty() ? new JSONObject() : new JSONObject(text);
        if (code == 401) {
            clearSession();
            throw new UnauthorizedException("Sessione scaduta.");
        }
        if (code < 200 || code >= 300) {
            throw new IOException(json.optString("error", "Errore server " + code));
        }
        return json;
    }

    private void restoreSessionCookie() {
        try {
            URI uri = URI.create(baseUrl);
            if (!uri.getHost().equals(preferences.getString("host", ""))) return;
            String value = preferences.getString("cookie", "");
            if (value.isEmpty()) return;
            HttpCookie cookie = new HttpCookie(SESSION_COOKIE, value);
            cookie.setPath("/");
            cookie.setSecure(true);
            cookie.setHttpOnly(true);
            cookieManager.getCookieStore().add(uri, cookie);
        } catch (Exception ignored) { clearSession(); }
    }

    private void persistSessionCookie() {
        for (HttpCookie cookie : cookieManager.getCookieStore().getCookies()) {
            if (SESSION_COOKIE.equals(cookie.getName()) && !cookie.hasExpired()) {
                String host = URI.create(baseUrl).getHost();
                preferences.edit().putString("host", host).putString("cookie", cookie.getValue()).apply();
                return;
            }
        }
    }

    private void clearSession() {
        csrf = null;
        cookieManager.getCookieStore().removeAll();
        preferences.edit().remove("host").remove("cookie").apply();
    }

    private static byte[] readAll(InputStream stream) throws IOException {
        try (InputStream input = stream; ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192];
            int count;
            while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
            return output.toByteArray();
        }
    }

    static final class UnauthorizedException extends IOException {
        UnauthorizedException(String message) { super(message); }
    }
}
