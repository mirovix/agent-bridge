package it.agentbridge.app;

import android.app.Dialog;
import android.graphics.Color;
import android.graphics.Typeface;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.text.method.ScrollingMovementMethod;
import android.webkit.CookieManager;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;

final class FocusDialog extends Dialog {
    private final MainActivity activity;
    private final ApiClient api;
    private final ExecutorService io;
    private final String jobId;
    private final String originalPrompt;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final List<Card> cards = new ArrayList<>();
    private FrameLayout cardHost;
    private TextView dots;
    private TextView hint;
    private TextView liveStatus;
    private Button finish;
    private Button statusButton;
    private Button reelsButton;
    private Button gamesButton;
    private WebView reels;
    private WebView happyDev;
    private int current;
    private boolean terminal;
    private boolean polling;
    private String visibleMode;
    private float touchY;

    FocusDialog(MainActivity activity, ApiClient api, ExecutorService io, JSONObject job, String prompt, String initialActivity) {
        super(activity, android.R.style.Theme_DeviceDefault_NoActionBar_Fullscreen);
        this.activity = activity;
        this.api = api;
        this.io = io;
        this.jobId = job.optString("id");
        this.originalPrompt = prompt;
        this.visibleMode = "happydev".equals(initialActivity) ? "happydev" : "reels";
        seedCards(job);
    }

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        Window window = getWindow();
        if (window != null) {
            window.setStatusBarColor(Ui.INK);
            window.setNavigationBarColor(Ui.INK);
            window.setLayout(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT);
        }
        setContentView(buildView());
        setOnDismissListener(dialog -> {
            handler.removeCallbacksAndMessages(null);
            if (reels != null) {
                reels.stopLoading();
                reels.destroy();
                reels = null;
            }
            if (happyDev != null) {
                happyDev.stopLoading();
                happyDev.destroy();
                happyDev = null;
            }
        });
    }

    @Override
    protected void onStart() {
        super.onStart();
        Window window = getWindow();
        if (window != null) window.setLayout(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT);
        schedulePoll(0);
    }

    private View buildView() {
        FrameLayout root = new FrameLayout(activity);
        root.setBackground(Ui.gradient(new int[]{Color.rgb(6, 9, 17), Color.rgb(29, 15, 48), Color.rgb(3, 24, 32)}, 0));

        LinearLayout content = new LinearLayout(activity);
        content.setOrientation(LinearLayout.VERTICAL);
        content.setPadding(Ui.dp(activity, 20), Ui.dp(activity, 30), Ui.dp(activity, 20), Ui.dp(activity, 25));
        root.addView(content, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        LinearLayout top = new LinearLayout(activity);
        top.setGravity(Gravity.CENTER_VERTICAL);
        LinearLayout labels = new LinearLayout(activity);
        labels.setOrientation(LinearLayout.VERTICAL);
        TextView eyebrow = Ui.text(activity, "FOCUS MODE", 11, Ui.CYAN);
        eyebrow.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        eyebrow.setLetterSpacing(.18f);
        labels.addView(eyebrow);
        liveStatus = Ui.text(activity, "Missione in avvio", 14, Color.WHITE);
        labels.addView(liveStatus);
        top.addView(labels, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        Button close = Ui.button(activity, "✕", false);
        close.setTextSize(20);
        close.setOnClickListener(v -> dismiss());
        top.addView(close, new LinearLayout.LayoutParams(Ui.dp(activity, 48), Ui.dp(activity, 48)));
        content.addView(top);

        LinearLayout modeBar = new LinearLayout(activity);
        modeBar.setOrientation(LinearLayout.HORIZONTAL);
        modeBar.setGravity(Gravity.CENTER);
        statusButton = modeButton("Stato", "status");
        reelsButton = modeButton("Reels", "reels");
        gamesButton = modeButton("HappyDEV", "happydev");
        addModeButton(modeBar, statusButton, 0);
        addModeButton(modeBar, reelsButton, Ui.dp(activity, 7));
        addModeButton(modeBar, gamesButton, Ui.dp(activity, 7));
        content.addView(modeBar, Ui.params(ViewGroup.LayoutParams.MATCH_PARENT, Ui.dp(activity, 44), Ui.dp(activity, 12)));

        FrameLayout stage = new FrameLayout(activity);
        LinearLayout.LayoutParams hostParams = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1);
        hostParams.topMargin = Ui.dp(activity, 20);
        hostParams.bottomMargin = Ui.dp(activity, 16);
        content.addView(stage, hostParams);

        cardHost = new FrameLayout(activity);
        stage.addView(cardHost, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        reels = new WebView(activity);
        configureReels(reels);
        stage.addView(reels, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        happyDev = new WebView(activity);
        configureHappyDev(happyDev);
        stage.addView(happyDev, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        dots = Ui.text(activity, "", 18, Color.WHITE);
        dots.setGravity(Gravity.CENTER);
        content.addView(dots, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, Ui.dp(activity, 28)));

        hint = Ui.text(activity, "Scorri in alto o in basso per cambiare scheda", 12, Ui.MUTED);
        hint.setGravity(Gravity.CENTER);
        content.addView(hint, Ui.params(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, Ui.dp(activity, 2)));

        finish = Ui.button(activity, "In esecuzione…", true);
        finish.setEnabled(false);
        finish.setOnClickListener(v -> dismiss());
        content.addView(finish, Ui.params(ViewGroup.LayoutParams.MATCH_PARENT, Ui.dp(activity, 56), Ui.dp(activity, 15)));
        renderCard(0, 0);
        showMode(visibleMode);
        return root;
    }

    private Button modeButton(String text, String mode) {
        Button button = Ui.button(activity, text, false);
        button.setTextSize(12);
        button.setOnClickListener(v -> showMode(mode));
        return button;
    }

    private void addModeButton(LinearLayout bar, Button button, int leftMargin) {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(0, Ui.dp(activity, 42), 1);
        params.leftMargin = leftMargin;
        bar.addView(button, params);
    }

    private void configureReels(WebView webView) {
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, true);
        webView.setBackgroundColor(Color.BLACK);
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return !"https".equalsIgnoreCase(request.getUrl().getScheme());
            }
        });
        webView.loadUrl("https://www.instagram.com/reels/");
    }

    private void configureHappyDev(WebView webView) {
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setMediaPlaybackRequiresUserGesture(false);
        webView.setBackgroundColor(Color.rgb(17, 19, 26));
        webView.setWebViewClient(new WebViewClient());
        webView.loadUrl("file:///android_asset/happydev/index.html");
    }

    private void showMode(String mode) {
        visibleMode = mode;
        boolean showReels = "reels".equals(mode);
        boolean showHappyDev = "happydev".equals(mode);
        if (reels != null) reels.setVisibility(showReels ? View.VISIBLE : View.GONE);
        if (happyDev != null) happyDev.setVisibility(showHappyDev ? View.VISIBLE : View.GONE);
        if (cardHost != null) cardHost.setVisibility("status".equals(mode) ? View.VISIBLE : View.GONE);
        if (dots != null) dots.setVisibility("status".equals(mode) ? View.VISIBLE : View.GONE);
        if (hint != null) hint.setVisibility("status".equals(mode) ? View.VISIBLE : View.GONE);
        updateModeButton(statusButton, "status".equals(mode));
        updateModeButton(reelsButton, showReels);
        updateModeButton(gamesButton, showHappyDev);
    }

    private void updateModeButton(Button button, boolean selected) {
        if (button == null) return;
        button.setAlpha(selected ? 1f : .55f);
        button.setTextColor(selected ? Color.WHITE : Ui.MUTED);
    }

    private void seedCards(JSONObject job) {
        cards.clear();
        cards.add(new Card("LA TUA MISSIONE", originalPrompt, "PROMPT", new int[]{Color.rgb(31, 70, 96), Color.rgb(31, 25, 72)}));
        cards.add(new Card("L'AGENTE È AL LAVORO", statusCopy(job.optString("status")), job.optString("agent", "AGENT").toUpperCase(), new int[]{Color.rgb(48, 30, 91), Color.rgb(16, 54, 76)}));
        cards.add(new Card("RISPOSTA", "La risposta apparirà qui appena l'agente produce il primo risultato.", "LIVE", new int[]{Color.rgb(20, 72, 68), Color.rgb(25, 30, 67)}));
        cards.add(new Card("DIETRO LE QUINTE", "Sto seguendo gli aggiornamenti della sessione in tempo reale.", "ATTIVITÀ", new int[]{Color.rgb(80, 38, 70), Color.rgb(30, 33, 67)}));
    }

    private void schedulePoll(long delay) {
        handler.postDelayed(this::poll, delay);
    }

    private void poll() {
        if (!isShowing() || polling || terminal) return;
        polling = true;
        io.execute(() -> {
            try {
                JSONObject detail = api.job(jobId);
                activity.runOnUiThread(() -> apply(detail));
            } catch (Exception exception) {
                activity.runOnUiThread(() -> {
                    if (exception instanceof ApiClient.UnauthorizedException) {
                        terminal = true;
                        dismiss();
                        Toast.makeText(activity, "Sessione scaduta: accedi di nuovo.", Toast.LENGTH_LONG).show();
                        activity.showLogin();
                    } else {
                        liveStatus.setText("Connessione interrotta · nuovo tentativo…");
                    }
                });
            } finally {
                activity.runOnUiThread(() -> {
                    polling = false;
                    if (!terminal && isShowing()) schedulePoll(1_000);
                });
            }
        });
    }

    private void apply(JSONObject detail) {
        JSONObject job = detail.optJSONObject("job");
        if (job == null) return;
        String status = job.optString("status", "running");
        liveStatus.setText(statusCopy(status));
        cards.get(1).body = statusCopy(status) + "\n\nCartella\n" + job.optString("cwd", "—");

        JSONArray events = detail.optJSONArray("events");
        String answer = "La risposta apparirà qui appena l'agente produce il primo risultato.";
        StringBuilder activityText = new StringBuilder();
        if (events != null) {
            int appended = 0;
            for (int i = events.length() - 1; i >= 0; i--) {
                JSONObject event = events.optJSONObject(i);
                if (event == null) continue;
                String text = event.optString("text").trim();
                if (text.isEmpty()) continue;
                if ("assistant".equals(event.optString("role")) && answer.startsWith("La risposta")) answer = text;
                if (appended < 3) {
                    if (activityText.length() > 0) activityText.append("\n\n");
                    activityText.append("• ").append(text);
                    appended++;
                }
            }
        }
        cards.get(2).body = answer;
        if (activityText.length() > 0) cards.get(3).body = activityText.toString();

        terminal = !status.equals("queued") && !status.equals("running");
        if (terminal) {
            boolean success = status.equals("done") || status.equals("completed") || status.equals("success");
            finish.setText(success ? "Missione completata  ✓" : "Chiudi — " + statusCopy(status));
            finish.setEnabled(true);
            finish.setText(success ? "Missione completata · torna alla chat  ✓" : "Chiudi — " + statusCopy(status));
            if (success && current == 1) current = 2;
            // Reels and HappyDEV are owned by this dialog, so dismissing it also
            // stops and destroys both WebViews in the onDismiss listener.
            handler.postDelayed(() -> {
                if (isShowing()) dismiss();
            }, 450);
        }
        renderCard(current, 0);
    }

    private void renderCard(int requested, int direction) {
        if (cards.isEmpty() || cardHost == null) return;
        current = (requested + cards.size()) % cards.size();
        Card card = cards.get(current);
        LinearLayout view = new LinearLayout(activity);
        view.setOrientation(LinearLayout.VERTICAL);
        view.setGravity(Gravity.BOTTOM);
        view.setPadding(Ui.dp(activity, 27), Ui.dp(activity, 30), Ui.dp(activity, 27), Ui.dp(activity, 32));
        view.setBackground(Ui.gradient(card.colors, Ui.dp(activity, 30)));
        view.setElevation(Ui.dp(activity, 18));

        TextView badge = Ui.text(activity, card.badge, 11, Ui.CYAN);
        badge.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        badge.setLetterSpacing(.16f);
        view.addView(badge);

        TextView title = Ui.title(activity, card.title, 30);
        title.setLetterSpacing(-.02f);
        view.addView(title, Ui.params(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, Ui.dp(activity, 12)));

        TextView body = Ui.text(activity, card.body, 17, Color.rgb(235, 239, 248));
        body.setLineSpacing(0, 1.18f);
        body.setMaxHeight(Ui.dp(activity, 310));
        body.setVerticalScrollBarEnabled(true);
        body.setMovementMethod(ScrollingMovementMethod.getInstance());
        body.setTextIsSelectable(true);
        view.addView(body, Ui.params(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, Ui.dp(activity, 18)));
        view.setOnTouchListener((target, event) -> onSwipe(target, event));

        cardHost.removeAllViews();
        cardHost.addView(view, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        if (direction != 0) {
            view.setTranslationY(direction * Ui.dp(activity, 90));
            view.setAlpha(.25f);
            view.animate().translationY(0).alpha(1).setDuration(220).start();
        }
        StringBuilder progress = new StringBuilder();
        for (int i = 0; i < cards.size(); i++) progress.append(i == current ? "●  " : "○  ");
        dots.setText(progress.toString().trim());
    }

    private boolean onSwipe(View target, MotionEvent event) {
        if (event.getAction() == MotionEvent.ACTION_DOWN) {
            touchY = event.getRawY();
            return true;
        }
        if (event.getAction() == MotionEvent.ACTION_MOVE) {
            target.setTranslationY((event.getRawY() - touchY) * .22f);
            return true;
        }
        if (event.getAction() == MotionEvent.ACTION_UP || event.getAction() == MotionEvent.ACTION_CANCEL) {
            float delta = event.getRawY() - touchY;
            target.setTranslationY(0);
            if (Math.abs(delta) > Ui.dp(activity, 55)) renderCard(current + (delta < 0 ? 1 : -1), delta < 0 ? 1 : -1);
            return true;
        }
        return false;
    }

    private static String statusCopy(String status) {
        switch (status) {
            case "queued": return "In coda";
            case "running": return "L'agente sta lavorando";
            case "done":
            case "completed":
            case "success": return "Completata";
            case "failed": return "Non riuscita";
            case "cancelled": return "Annullata";
            default: return status.isEmpty() ? "In esecuzione" : status;
        }
    }

    private static final class Card {
        final String title;
        String body;
        final String badge;
        final int[] colors;

        Card(String title, String body, String badge, int[] colors) {
            this.title = title;
            this.body = body;
            this.badge = badge;
            this.colors = colors;
        }
    }
}
