/*
 * Android entry point for the bundled MailBox Manager interface.
 * Build with `npm run android:debug`; Capacitor serves bundled public/ assets locally.
 * It handles Android Back, trusted .eml downloads, verified updates, and legacy storage permission.
 */
package com.faidlix.mailboxmanager;

import android.Manifest;
import android.content.ClipData;
import android.app.DownloadManager;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.URLUtil;
import android.webkit.WebView;
import android.widget.Toast;
import androidx.activity.OnBackPressedCallback;
import androidx.annotation.NonNull;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import androidx.core.content.FileProvider;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.WebViewListener;
import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.net.URI;
import java.util.ArrayList;
import java.util.Locale;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONArray;
import org.json.JSONObject;

public class MainActivity extends BridgeActivity {

    private static final String TRUSTED_HOST = "localhost";
    private static final String EML_MIME_TYPE = "message/rfc822";
    private static final int STORAGE_PERMISSION_REQUEST = 4107;
    private static final int MAX_EML_BYTES = 50 * 1024 * 1024;
    private static final int MAX_SHARED_FILES = 50;

    private static final String INSTALL_DOWNLOAD_BRIDGE_TEMPLATE = """
        (() => {
          if (location.hostname !== '%s' || window.__mailBoxAndroidDownloadBridge) return;
          window.__mailBoxAndroidDownloadBridge = true;
          document.addEventListener('click', async (event) => {
            const link = event.target.closest?.('a[download]');
            if (!link || !link.href.startsWith('blob:')) return;
            event.preventDefault();
            event.stopImmediatePropagation();
            try {
              const blob = await fetch(link.href).then((response) => response.blob());
              if (blob.size > %d) throw new Error('郵件超過 50 MB 上限');
              const bytes = new Uint8Array(await blob.arrayBuffer());
              let binary = '';
              for (let offset = 0; offset < bytes.length; offset += 32768) {
                binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
              }
              MailBoxAndroid.saveEml('%s', link.download || 'message.eml', btoa(binary));
            } catch (error) {
              MailBoxAndroid.downloadFailed('%s', String(error?.message || error));
            }
          }, true);
          window.mailBoxNativeShare = async (files, title) => {
            if (!Array.isArray(files) || !files.length || files.length > %d) throw new Error('分享檔案數量不符合限制');
            let totalBytes = 0;
            const payload = [];
            for (const file of files) {
              totalBytes += Number(file.size || 0);
              if (totalBytes > %d) throw new Error('分享檔案超過 50 MB 上限');
              const bytes = new Uint8Array(await file.arrayBuffer());
              let binary = '';
              for (let offset = 0; offset < bytes.length; offset += 32768) {
                binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
              }
              payload.push({ name: file.name || 'mailbox-file', type: file.type || 'application/octet-stream', data: btoa(binary) });
            }
            MailBoxAndroid.shareFiles('%s', String(title || ''), JSON.stringify(payload));
          };
        })();
        """;

    private static final String HANDLE_BACK = """
        (() => {
          const openDialog = [...document.querySelectorAll('dialog[open]')].pop();
          if (openDialog) { openDialog.close(); return true; }
          if (document.body.classList.contains('filters-open')) {
            if (typeof setFilterDrawer === 'function') setFilterDrawer(false);
            else document.body.classList.remove('filters-open');
            return true;
          }
          const menu = document.querySelector('#message-action-menu:not([hidden])');
          if (menu) { menu.hidden = true; return true; }
          const mobileBack = document.querySelector('.mail-layout.mobile-detail-open [data-action="back"]');
          if (mobileBack) { mobileBack.click(); return true; }
          const inlineClose = document.querySelector('.inline-panel-close');
          if (inlineClose) { inlineClose.click(); return true; }
          return false;
        })();
        """;

    private final ExecutorService downloadExecutor = Executors.newSingleThreadExecutor();
    private final String bridgeToken = UUID.randomUUID().toString();
    private volatile boolean trustedPageLoaded;
    private PendingEml pendingEml;
    private PendingHttpDownload pendingHttpDownload;
    private AppUpdateManager appUpdateManager;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        WebView webView = bridge.getWebView();
        webView.addJavascriptInterface(new EmlDownloadBridge(), "MailBoxAndroid");
        webView.setDownloadListener(this::handleHttpDownload);
        bridge.addWebViewListener(new WebViewListener() {
            @Override
            public void onPageStarted(WebView loadedView) {
                trustedPageLoaded = false;
            }

            @Override
            public void onPageLoaded(WebView loadedView) {
                trustedPageLoaded = isTrustedAppUrl(loadedView.getUrl());
                if (trustedPageLoaded) loadedView.evaluateJavascript(createDownloadBridgeScript(), null);
            }
        });
        appUpdateManager = new AppUpdateManager(this);

        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                handleAndroidBack(webView);
            }
        });
    }

    @Override
    public void onResume() {
        super.onResume();
        if (appUpdateManager != null) appUpdateManager.checkIfDue();
    }

    private void handleAndroidBack(WebView webView) {
        webView.evaluateJavascript(HANDLE_BACK, result -> {
            if ("true".equals(result)) return;
            if (webView.canGoBack()) webView.goBack();
            else finish();
        });
    }

    private void handleHttpDownload(String url, String userAgent, String contentDisposition, String mimeType, long contentLength) {
        Uri uri = Uri.parse(url);
        if (!isTrustedAppUrl(url)) {
            Toast.makeText(this, "已阻擋非信任來源的下載", Toast.LENGTH_LONG).show();
            return;
        }
        String filename = normalizeEmlFilename(URLUtil.guessFileName(url, contentDisposition, EML_MIME_TYPE));
        PendingHttpDownload download = new PendingHttpDownload(url, userAgent, filename);
        if (needsLegacyStoragePermission()) {
            pendingHttpDownload = download;
            requestLegacyStoragePermission();
        } else {
            enqueueHttpDownload(download);
        }
    }

    private void enqueueHttpDownload(PendingHttpDownload download) {
        DownloadManager.Request request = new DownloadManager.Request(Uri.parse(download.url));
        request.setMimeType(EML_MIME_TYPE);
        request.setTitle(download.filename);
        request.setDescription("MailBox Manager 郵件下載");
        request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
        request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, download.filename);
        String cookies = CookieManager.getInstance().getCookie(download.url);
        if (cookies != null && !cookies.isBlank()) request.addRequestHeader("Cookie", cookies);
        if (download.userAgent != null && !download.userAgent.isBlank()) request.addRequestHeader("User-Agent", download.userAgent);
        DownloadManager manager = (DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE);
        manager.enqueue(request);
        Toast.makeText(this, "正在下載 " + download.filename, Toast.LENGTH_LONG).show();
    }

    private boolean needsLegacyStoragePermission() {
        return Build.VERSION.SDK_INT <= Build.VERSION_CODES.P
            && ContextCompat.checkSelfPermission(this, Manifest.permission.WRITE_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED;
    }

    private void requestLegacyStoragePermission() {
        ActivityCompat.requestPermissions(
            this,
            new String[] { Manifest.permission.WRITE_EXTERNAL_STORAGE },
            STORAGE_PERMISSION_REQUEST
        );
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, @NonNull String[] permissions, @NonNull int[] grantResults) {
        if (requestCode != STORAGE_PERMISSION_REQUEST) {
            super.onRequestPermissionsResult(requestCode, permissions, grantResults);
            return;
        }
        if (grantResults.length == 0 || grantResults[0] != PackageManager.PERMISSION_GRANTED) {
            pendingEml = null;
            pendingHttpDownload = null;
            Toast.makeText(this, "未授予檔案權限，無法儲存郵件", Toast.LENGTH_LONG).show();
            return;
        }
        if (pendingEml != null) {
            PendingEml download = pendingEml;
            pendingEml = null;
            saveEml(download);
        }
        if (pendingHttpDownload != null) {
            PendingHttpDownload download = pendingHttpDownload;
            pendingHttpDownload = null;
            enqueueHttpDownload(download);
        }
    }

    private void saveEml(PendingEml download) {
        downloadExecutor.execute(() -> {
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    ContentValues values = new ContentValues();
                    values.put(MediaStore.Downloads.DISPLAY_NAME, download.filename);
                    values.put(MediaStore.Downloads.MIME_TYPE, EML_MIME_TYPE);
                    values.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS);
                    Uri target = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
                    if (target == null) throw new IllegalStateException("無法建立下載檔案");
                    try (OutputStream output = getContentResolver().openOutputStream(target)) {
                        if (output == null) throw new IllegalStateException("無法開啟下載檔案");
                        output.write(download.bytes);
                    }
                } else {
                    File downloads = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
                    if (!downloads.exists() && !downloads.mkdirs()) throw new IllegalStateException("無法建立下載資料夾");
                    try (OutputStream output = new FileOutputStream(uniqueFile(downloads, download.filename))) {
                        output.write(download.bytes);
                    }
                }
                runOnUiThread(() -> Toast.makeText(this, "已儲存到下載資料夾：" + download.filename, Toast.LENGTH_LONG).show());
            } catch (Exception error) {
                runOnUiThread(() -> Toast.makeText(this, "郵件下載失敗：" + error.getMessage(), Toast.LENGTH_LONG).show());
            }
        });
    }

    private static File uniqueFile(File directory, String filename) {
        File candidate = new File(directory, filename);
        if (!candidate.exists()) return candidate;
        String stem = filename.substring(0, filename.length() - 4);
        for (int index = 2; index < 1000; index++) {
            candidate = new File(directory, stem + " (" + index + ").eml");
            if (!candidate.exists()) return candidate;
        }
        return new File(directory, stem + "-" + System.currentTimeMillis() + ".eml");
    }

    static String normalizeEmlFilename(String filename) {
        String safe = filename == null ? "message.eml" : filename.replaceAll("[\\\\/:*?\"<>|\\r\\n]", "_").trim();
        if (safe.isEmpty()) safe = "message.eml";
        if (!safe.toLowerCase(Locale.ROOT).endsWith(".eml")) safe += ".eml";
        if (safe.length() > 100) safe = safe.substring(0, 96) + ".eml";
        return safe;
    }

    static String normalizeSharedFilename(String filename) {
        String safe = filename == null ? "mailbox-file" : filename.replaceAll("[\\\\/:*?\"<>|\\r\\n]", "_").trim();
        if (safe.isEmpty() || ".".equals(safe) || "..".equals(safe)) safe = "mailbox-file";
        if (safe.length() > 120) safe = safe.substring(0, 120);
        return safe;
    }

    static String normalizeMimeType(String mimeType) {
        if (mimeType == null || !mimeType.matches("[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]*/[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]*")) {
            return "application/octet-stream";
        }
        return mimeType.toLowerCase(Locale.ROOT);
    }

    static boolean isTrustedAppUrl(String url) {
        if (url == null || url.isBlank()) return false;
        try {
            URI uri = URI.create(url);
            int port = uri.getPort();
            return "https".equalsIgnoreCase(uri.getScheme())
                && TRUSTED_HOST.equalsIgnoreCase(uri.getHost())
                && uri.getRawUserInfo() == null
                && (port == -1 || port == 443);
        } catch (IllegalArgumentException error) {
            return false;
        }
    }

    private String createDownloadBridgeScript() {
        return String.format(Locale.ROOT, INSTALL_DOWNLOAD_BRIDGE_TEMPLATE,
            TRUSTED_HOST, MAX_EML_BYTES, bridgeToken, bridgeToken,
            MAX_SHARED_FILES, MAX_EML_BYTES, bridgeToken);
    }

    private boolean isTrustedBridgeCall(String token) {
        return trustedPageLoaded && bridgeToken.equals(token);
    }

    private final class EmlDownloadBridge {
        @JavascriptInterface
        public void saveEml(String token, String filename, String base64Data) {
            if (!isTrustedBridgeCall(token)) return;
            try {
                byte[] bytes = Base64.decode(base64Data, Base64.DEFAULT);
                if (bytes.length == 0 || bytes.length > MAX_EML_BYTES) throw new IllegalArgumentException("郵件大小不符合限制");
                PendingEml download = new PendingEml(normalizeEmlFilename(filename), bytes);
                runOnUiThread(() -> {
                    if (needsLegacyStoragePermission()) {
                        pendingEml = download;
                        requestLegacyStoragePermission();
                    } else {
                        MainActivity.this.saveEml(download);
                    }
                });
            } catch (Exception error) {
                downloadFailed(token, error.getMessage());
            }
        }

        @JavascriptInterface
        public void downloadFailed(String token, String message) {
            if (!isTrustedBridgeCall(token)) return;
            runOnUiThread(() -> Toast.makeText(MainActivity.this, "郵件下載失敗：" + message, Toast.LENGTH_LONG).show());
        }

        @JavascriptInterface
        public void shareFiles(String token, String title, String jsonPayload) {
            if (!isTrustedBridgeCall(token)) return;
            downloadExecutor.execute(() -> {
                try {
                    JSONArray payload = new JSONArray(jsonPayload);
                    if (payload.length() == 0 || payload.length() > MAX_SHARED_FILES) {
                        throw new IllegalArgumentException("分享檔案數量不符合限制");
                    }
                    File directory = new File(getCacheDir(), "shared-exports");
                    if (!directory.exists() && !directory.mkdirs()) throw new IllegalStateException("無法建立分享暫存資料夾");
                    File[] staleFiles = directory.listFiles();
                    if (staleFiles != null) for (File staleFile : staleFiles) if (staleFile.isFile()) staleFile.delete();

                    ArrayList<Uri> uris = new ArrayList<>();
                    ArrayList<String> mimeTypes = new ArrayList<>();
                    int totalBytes = 0;
                    for (int index = 0; index < payload.length(); index++) {
                        JSONObject item = payload.getJSONObject(index);
                        byte[] bytes = Base64.decode(item.getString("data"), Base64.DEFAULT);
                        totalBytes += bytes.length;
                        if (bytes.length == 0 || totalBytes > MAX_EML_BYTES) throw new IllegalArgumentException("分享檔案大小不符合限制");
                        String filename = normalizeSharedFilename(item.optString("name", "mailbox-file"));
                        String mimeType = normalizeMimeType(item.optString("type", "application/octet-stream"));
                        File target = uniqueSharedFile(directory, filename);
                        try (OutputStream output = new FileOutputStream(target)) { output.write(bytes); }
                        uris.add(FileProvider.getUriForFile(MainActivity.this, BuildConfig.APPLICATION_ID + ".fileprovider", target));
                        mimeTypes.add(mimeType);
                    }
                    runOnUiThread(() -> openShareSheet(title, uris, mimeTypes));
                } catch (Exception error) {
                    runOnUiThread(() -> Toast.makeText(MainActivity.this, "分享檔案失敗：" + error.getMessage(), Toast.LENGTH_LONG).show());
                }
            });
        }
    }

    private static File uniqueSharedFile(File directory, String filename) {
        File candidate = new File(directory, filename);
        if (!candidate.exists()) return candidate;
        int dot = filename.lastIndexOf('.');
        String stem = dot > 0 ? filename.substring(0, dot) : filename;
        String extension = dot > 0 ? filename.substring(dot) : "";
        for (int index = 2; index < 1000; index++) {
            candidate = new File(directory, stem + " (" + index + ")" + extension);
            if (!candidate.exists()) return candidate;
        }
        return new File(directory, stem + "-" + System.currentTimeMillis() + extension);
    }

    private void openShareSheet(String title, ArrayList<Uri> uris, ArrayList<String> mimeTypes) {
        Intent shareIntent = new Intent(uris.size() == 1 ? Intent.ACTION_SEND : Intent.ACTION_SEND_MULTIPLE);
        String commonType = mimeTypes.stream().allMatch(mimeTypes.get(0)::equals) ? mimeTypes.get(0) : "*/*";
        shareIntent.setType(commonType);
        shareIntent.putExtra(Intent.EXTRA_SUBJECT, title == null ? "" : title);
        if (uris.size() == 1) shareIntent.putExtra(Intent.EXTRA_STREAM, uris.get(0));
        else shareIntent.putParcelableArrayListExtra(Intent.EXTRA_STREAM, uris);
        ClipData clipData = new ClipData("MailBox Manager", new String[] { commonType }, new ClipData.Item(uris.get(0)));
        for (int index = 1; index < uris.size(); index++) clipData.addItem(new ClipData.Item(uris.get(index)));
        shareIntent.setClipData(clipData);
        shareIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        startActivity(Intent.createChooser(shareIntent, "分享到其他應用程式"));
    }

    @Override
    public void onDestroy() {
        if (appUpdateManager != null) appUpdateManager.close();
        downloadExecutor.shutdownNow();
        super.onDestroy();
    }

    private record PendingEml(String filename, byte[] bytes) {}

    private record PendingHttpDownload(String url, String userAgent, String filename) {}
}
