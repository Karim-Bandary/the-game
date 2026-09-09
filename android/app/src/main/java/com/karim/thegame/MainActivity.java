package com.karim.thegame;

import android.app.Activity;
import android.graphics.Color;
import android.os.Bundle;
import android.view.View;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebSettings;
import android.webkit.WebView;

/**
 * The whole app: one WebView showing the offline game bundle.
 *
 * Everything the player sees is game/index.html, copied into assets at build
 * time. Keeping the Android side this thin means there is almost nothing here
 * that can break differently from the browser version we test every day.
 */
public class MainActivity extends Activity {

    private WebView web;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);

        web = new WebView(this);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        // The layout is a fixed phone design. Letting Android's font-size
        // setting scale it would push the meters and the tab bar out of place.
        s.setTextZoom(100);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        // Nothing is loaded over the network, so no reason to allow it.
        s.setBlockNetworkLoads(true);
        s.setCacheMode(WebSettings.LOAD_NO_CACHE);

        // Without this the WebView flashes white before the page paints, which
        // on a dark game reads as a bug.
        web.setBackgroundColor(Color.parseColor("#0D0F14"));
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);

        // The page cannot close the app by itself, so the Exit button on the
        // menu calls in here. The name on both sides ("TheGame.exitApp") is
        // compared by tools/check_android.py — a rename on one side alone
        // leaves a button that looks alive and does nothing at all.
        web.addJavascriptInterface(new Bridge(), "TheGame");

        web.loadUrl("file:///android_asset/index.html");
        setContentView(web);

        // Draw behind the status bar; the CSS already reserves the safe areas.
        getWindow().setStatusBarColor(Color.parseColor("#141922"));
        getWindow().setNavigationBarColor(Color.parseColor("#141922"));
        getWindow().clearFlags(WindowManager.LayoutParams.FLAG_TRANSLUCENT_STATUS);
    }

    /** The only thing the page is allowed to ask the shell to do. */
    private class Bridge {
        @JavascriptInterface
        public void exitApp() {
            // The call arrives on the WebView's own thread, and finishing an
            // activity from anywhere but the UI thread does nothing.
            runOnUiThread(() -> finishAndRemoveTask());
        }
    }

    /**
     * The back button must not throw the player out of a game in progress.
     * The page gets first refusal — it closes an open sheet and reports that it
     * handled the press. Only if it did not do we send the app to the
     * background, which keeps the game alive instead of destroying it.
     */
    @Override
    public void onBackPressed() {
        web.evaluateJavascript(
            "(typeof onAndroidBack === 'function' && onAndroidBack()) ? 'handled' : 'exit'",
            value -> {
                if (!"\"handled\"".equals(value)) {
                    moveTaskToBack(true);
                }
            });
    }
}
