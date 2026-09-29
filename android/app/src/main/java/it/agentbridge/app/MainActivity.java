package it.agentbridge.app;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.Rect;
import android.media.MediaRecorder;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.text.InputType;
import android.text.Editable;
import android.text.TextWatcher;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.inputmethod.InputMethodManager;
import android.widget.ArrayAdapter;
import android.widget.Button;
import android.widget.EditText;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.Spinner;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class MainActivity extends Activity {
    private static final int AUDIO_PERMISSION = 81;
    private static final String DEFAULT_SERVER = "";

    private final ExecutorService io = Executors.newCachedThreadPool();
    private ApiClient api;
    private JSONObject me;
    private MediaRecorder recorder;
    private File recordingFile;
    private Button micButton;
    private EditText promptField;
    private TextView notice;
    private boolean recording;

    @Override
    public boolean dispatchTouchEvent(MotionEvent event) {
        if (event.getAction() == MotionEvent.ACTION_DOWN) {
            View focused = getCurrentFocus();
            if (focused instanceof EditText) {
                Rect bounds = new Rect();
                focused.getGlobalVisibleRect(bounds);
                if (!bounds.contains((int) event.getRawX(), (int) event.getRawY())) {
                    hideKeyboard();
                    focused.clearFocus();
                }
            }
        }
        return super.dispatchTouchEvent(event);
    }

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        Window window = getWindow();
        window.setStatusBarColor(Ui.INK);
        window.setNavigationBarColor(Ui.INK);
        String server = getPreferences(MODE_PRIVATE).getString("server", DEFAULT_SERVER);
        api = new ApiClient(getApplicationContext(), server);
        showSplash();
        io.execute(() -> {
            try {
                JSONObject profile = api.me();
                runOnUiThread(() -> showHome(profile));
            } catch (Exception ignored) {
                runOnUiThread(this::showLogin);
            }
        });
    }

    private LinearLayout page() {
        LinearLayout page = new LinearLayout(this);
        page.setOrientation(LinearLayout.VERTICAL);
        page.setPadding(Ui.dp(this, 22), Ui.dp(this, 28), Ui.dp(this, 22), Ui.dp(this, 30));
        page.setBackground(Ui.gradient(new int[]{Color.rgb(7, 10, 18), Color.rgb(18, 10, 34), Color.rgb(4, 20, 29)}, 0));
        return page;
    }

    private ScrollView scrollingPage(LinearLayout content) {
        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        scroll.setBackgroundColor(Ui.INK);
        scroll.addView(content, new ScrollView.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        return scroll;
    }

    private void showSplash() {
        LinearLayout root = page();
        root.setGravity(Gravity.CENTER);
        ImageView logo = logo(110);
        root.addView(logo);
        TextView title = Ui.title(this, "Agent Bridge", 30);
        title.setGravity(Gravity.CENTER);
        root.addView(title, Ui.params(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, Ui.dp(this, 18)));
        TextView loading = Ui.text(this, "Connecting securely…", 14, Ui.MUTED);
        loading.setGravity(Gravity.CENTER);
        root.addView(loading, Ui.params(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, Ui.dp(this, 8)));
        setContentView(root);
    }

    private ImageView logo(int size) {
        ImageView logo = new ImageView(this);
        logo.setImageResource(R.drawable.agent_bridge_icon);
        logo.setScaleType(ImageView.ScaleType.FIT_CENTER);
        logo.setClipToOutline(true);
        logo.setBackground(Ui.gradient(new int[]{Color.rgb(16, 20, 33), Color.rgb(31, 19, 55)}, Ui.dp(this, 28)));
        logo.setPadding(Ui.dp(this, 5), Ui.dp(this, 5), Ui.dp(this, 5), Ui.dp(this, 5));
        logo.setLayoutParams(new LinearLayout.LayoutParams(Ui.dp(this, size), Ui.dp(this, size)));
        return logo;
    }

    void showLogin() {
        LinearLayout root = page();
        root.setGravity(Gravity.CENTER_HORIZONTAL);
        root.addView(logo(92));
        TextView title = Ui.title(this, "Welcome back", 31);
        title.setGravity(Gravity.CENTER);
        root.addView(title, Ui.params(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, Ui.dp(this, 18)));
        TextView subtitle = Ui.text(this, "Sign in to your private bridge to Codex and Claude.", 15, Ui.MUTED);
        subtitle.setGravity(Gravity.CENTER);
        root.addView(subtitle, Ui.params(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, Ui.dp(this, 6)));

        LinearLayout panel = new LinearLayout(this);
        panel.setOrientation(LinearLayout.VERTICAL);
        panel.setPadding(Ui.dp(this, 18), Ui.dp(this, 20), Ui.dp(this, 18), Ui.dp(this, 20));
        panel.setBackground(Ui.panel(this));

        EditText server = Ui.field(this, "Server HTTPS");
        server.setText(getPreferences(MODE_PRIVATE).getString("server", DEFAULT_SERVER));
        server.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        panel.addView(server, Ui.params(ViewGroup.LayoutParams.MATCH_PARENT, Ui.dp(this, 54), 0));

        EditText password = Ui.field(this, "Password");
        password.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);
        panel.addView(password, Ui.params(ViewGroup.LayoutParams.MATCH_PARENT, Ui.dp(this, 54), Ui.dp(this, 12)));

        EditText code = Ui.field(this, "2FA or recovery code");
        code.setInputType(InputType.TYPE_CLASS_NUMBER);
        code.setGravity(Gravity.CENTER);
        code.setAutofillHints("smsOTPCode");
        panel.addView(code, Ui.params(ViewGroup.LayoutParams.MATCH_PARENT, Ui.dp(this, 54), Ui.dp(this, 12)));

        final boolean[] recoveryMode = {false};
        Button codeMode = Ui.button(this, "Use a recovery code", false);
        codeMode.setOnClickListener(v -> {
            recoveryMode[0] = !recoveryMode[0];
            code.setText("");
            code.setHint(recoveryMode[0] ? "Recovery code" : "6-digit 2FA code");
            code.setInputType(recoveryMode[0]
                    ? InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_CAP_CHARACTERS | InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS
                    : InputType.TYPE_CLASS_NUMBER);
            code.setGravity(Gravity.CENTER);
            codeMode.setText(recoveryMode[0] ? "Use a 2FA code" : "Use a recovery code");
        });
        panel.addView(codeMode, Ui.params(ViewGroup.LayoutParams.MATCH_PARENT, Ui.dp(this, 48), Ui.dp(this, 8)));

        TextView error = Ui.text(this, "", 14, Color.rgb(255, 120, 135));
        panel.addView(error, Ui.params(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, Ui.dp(this, 10)));

        Button login = Ui.button(this, "Sign in", true);
        panel.addView(login, Ui.params(ViewGroup.LayoutParams.MATCH_PARENT, Ui.dp(this, 56), Ui.dp(this, 4)));
        login.setOnClickListener(view -> {
            String serverValue = server.getText().toString().trim();
            if (password.getText().length() == 0 || code.getText().toString().trim().isEmpty()) {
                error.setText("Enter your password and code before signing in.");
                return;
            }
            if (!serverValue.startsWith("https://")) {
                error.setText("The server must start with https://");
                return;
            }
            hideKeyboard();
            login.setEnabled(false);
            login.setText("Signing in…");
            error.setText("");
            api.setBaseUrl(serverValue);
            io.execute(() -> {
                try {
                    JSONObject profile = api.login(password.getText().toString(), code.getText().toString().trim());
                    getPreferences(MODE_PRIVATE).edit().putString("server", serverValue).apply();
                    runOnUiThread(() -> showHome(profile));
                } catch (Exception exception) {
                    runOnUiThread(() -> {
                        error.setText(message(exception));
                        login.setText("Sign in");
                        login.setEnabled(true);
                    });
                }
            });
        });

        root.addView(panel, Ui.params(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, Ui.dp(this, 26)));
        setContentView(scrollingPage(root));
    }

    private void showHome(JSONObject profile) {
        me = profile;
        LinearLayout root = page();

        LinearLayout header = new LinearLayout(this);
        header.setGravity(Gravity.CENTER_VERTICAL);
        header.addView(logo(54));
        LinearLayout heading = new LinearLayout(this);
        heading.setOrientation(LinearLayout.VERTICAL);
        TextView eyebrow = Ui.text(this, "AGENT BRIDGE", 11, Ui.CYAN);
        eyebrow.setLetterSpacing(.18f);
        heading.addView(eyebrow);
        heading.addView(Ui.title(this, "New mission", 27));
        header.addView(heading, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        Button logout = Ui.button(this, "Sign out", false);
        header.addView(logout, new LinearLayout.LayoutParams(Ui.dp(this, 76), Ui.dp(this, 46)));
        logout.setOnClickListener(v -> io.execute(() -> {
            try { api.logout(); } catch (Exception ignored) {}
            runOnUiThread(this::showLogin);
        }));
        root.addView(header);

        TextView host = Ui.text(this, "●  " + profile.optString("host", "online"), 13, Color.rgb(92, 232, 166));
        root.addView(host, Ui.params(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, Ui.dp(this, 18)));

        LinearLayout panel = new LinearLayout(this);
        panel.setOrientation(LinearLayout.VERTICAL);
        panel.setPadding(Ui.dp(this, 18), Ui.dp(this, 18), Ui.dp(this, 18), Ui.dp(this, 20));
        panel.setBackground(Ui.panel(this));

        panel.addView(label("Assistant"));
        JSONArray agents = profile.optJSONArray("agents");
        List<String> agentNames = new ArrayList<>();
        if (agents != null) {
            for (int i = 0; i < agents.length(); i++) agentNames.add(agents.optJSONObject(i).optString("name", agents.optJSONObject(i).optString("id")));
        }
        Spinner agentSpinner = spinner(agentNames);
        panel.addView(agentSpinner, Ui.params(ViewGroup.LayoutParams.MATCH_PARENT, Ui.dp(this, 52), Ui.dp(this, 6)));

        panel.addView(labelWithTop("Folder", 16));
        LinkedHashSet<String> paths = new LinkedHashSet<>();
        JSONObject workspaces = profile.optJSONObject("workspaces");
        if (workspaces != null) {
            addStrings(paths, workspaces.optJSONArray("recent"));
            addStrings(paths, workspaces.optJSONArray("roots"));
        }
        EditText directory = Ui.field(this, "Working folder");
        directory.setText(paths.isEmpty() ? "" : paths.iterator().next());
        panel.addView(directory, Ui.params(ViewGroup.LayoutParams.MATCH_PARENT, Ui.dp(this, 54), Ui.dp(this, 6)));

        panel.addView(labelWithTop("Message", 16));
        promptField = Ui.field(this, "Write a message…");
        promptField.setSingleLine(false);
        promptField.setGravity(Gravity.TOP);
        promptField.setPadding(Ui.dp(this, 16), Ui.dp(this, 14), Ui.dp(this, 16), Ui.dp(this, 14));
        promptField.setMinHeight(Ui.dp(this, 92));
        panel.addView(promptField, Ui.params(ViewGroup.LayoutParams.MATCH_PARENT, Ui.dp(this, 100), Ui.dp(this, 6)));
        int maxPromptCharacters = profile.optInt("maxPromptChars", 20_000);
        TextView promptCount = Ui.text(this, "0/" + maxPromptCharacters, 11, Ui.MUTED);
        promptCount.setGravity(Gravity.END);
        panel.addView(promptCount, Ui.params(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, Ui.dp(this, 4)));

        panel.addView(labelWithTop("While you wait", 12));
        List<String> leisureChoices = new ArrayList<>();
        leisureChoices.add("Instagram Reels");
        leisureChoices.add("HappyDEV · 5 games");
        Spinner leisureSpinner = spinner(leisureChoices);
        String savedLeisure = getPreferences(MODE_PRIVATE).getString("waitingActivity", "reels");
        leisureSpinner.setSelection("happydev".equals(savedLeisure) ? 1 : 0);
        leisureSpinner.setOnItemSelectedListener(new android.widget.AdapterView.OnItemSelectedListener() {
            @Override public void onItemSelected(android.widget.AdapterView<?> parent, View view, int position, long id) {
                getPreferences(MODE_PRIVATE).edit().putString("waitingActivity", position == 1 ? "happydev" : "reels").apply();
            }
            @Override public void onNothingSelected(android.widget.AdapterView<?> parent) {}
        });
        panel.addView(leisureSpinner, Ui.params(ViewGroup.LayoutParams.MATCH_PARENT, Ui.dp(this, 48), Ui.dp(this, 5)));

        LinearLayout actions = new LinearLayout(this);
        actions.setOrientation(LinearLayout.HORIZONTAL);
        micButton = Ui.button(this, "●  Speak", false);
        actions.addView(micButton, new LinearLayout.LayoutParams(0, Ui.dp(this, 56), .38f));
        Button send = Ui.button(this, "Send  →", true);
        LinearLayout.LayoutParams sendParams = new LinearLayout.LayoutParams(0, Ui.dp(this, 56), .62f);
        sendParams.leftMargin = Ui.dp(this, 10);
        actions.addView(send, sendParams);
        panel.addView(actions, Ui.params(ViewGroup.LayoutParams.MATCH_PARENT, Ui.dp(this, 56), Ui.dp(this, 14)));

        notice = Ui.text(this, "Continuous chat on · prompts stay in the same conversation on your PC.", 12, Color.rgb(92, 232, 166));
        panel.addView(notice, Ui.params(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, Ui.dp(this, 10)));

        micButton.setOnClickListener(v -> toggleRecording());
        send.setOnClickListener(v -> {
            String prompt = promptField.getText().toString().trim();
            if (prompt.isEmpty()) {
                notice.setText("Type or dictate a prompt before sending it.");
                return;
            }
            if (prompt.length() > maxPromptCharacters) {
                notice.setText("The prompt is too long: shorten it before sending.");
                return;
            }
            int index = agentSpinner.getSelectedItemPosition();
            JSONObject agent = agents == null ? null : agents.optJSONObject(Math.max(0, index));
            if (agent == null) return;
            hideKeyboard();
            send.setEnabled(false);
            send.setText("Starting…");
            notice.setText("Preparing the mission.");
            JSONObject request = new JSONObject();
            try {
                request.put("agent", agent.optString("id"));
                request.put("sessionId", JSONObject.NULL);
                request.put("cwd", directory.getText().toString().trim());
                String mode = agent.optString("defaultMode", "");
                request.put("mode", mode.isEmpty() ? JSONObject.NULL : mode);
                request.put("model", JSONObject.NULL);
                request.put("effort", JSONObject.NULL);
                request.put("prompt", prompt);
                request.put("fork", false);
                request.put("images", JSONObject.NULL);
            } catch (Exception ignored) {}
            io.execute(() -> {
                try {
                    JSONObject job = api.startJob(request);
                    runOnUiThread(() -> {
                        send.setText("Send  →");
                        send.setEnabled(true);
                        promptField.setText("");
                        String leisure = leisureSpinner.getSelectedItemPosition() == 1 ? "happydev" : "reels";
                        new FocusDialog(this, api, io, job, prompt, leisure).show();
                    });
                } catch (Exception exception) {
                    runOnUiThread(() -> {
                        if (showLoginIfExpired(exception)) return;
                        send.setText("Send  →");
                        send.setEnabled(true);
                        notice.setText(message(exception));
                    });
                }
            });
        });

        promptField.addTextChangedListener(new TextWatcher() {
            @Override public void beforeTextChanged(CharSequence s, int start, int count, int after) {}
            @Override public void onTextChanged(CharSequence s, int start, int before, int count) {
                promptCount.setText(s.length() + "/" + maxPromptCharacters);
                promptCount.setTextColor(s.length() > maxPromptCharacters ? Color.rgb(255, 105, 124) : Ui.MUTED);
            }
            @Override public void afterTextChanged(Editable s) {}
        });

        root.addView(panel, Ui.params(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, Ui.dp(this, 24)));
        setContentView(scrollingPage(root));
    }

    private TextView label(String value) {
        TextView label = Ui.text(this, value.toUpperCase(), 11, Ui.MUTED);
        label.setTypeface(null, android.graphics.Typeface.BOLD);
        label.setLetterSpacing(.12f);
        return label;
    }

    private TextView labelWithTop(String value, int top) {
        TextView label = label(value);
        label.setPadding(0, Ui.dp(this, top), 0, 0);
        return label;
    }

    private Spinner spinner(List<String> values) {
        Spinner spinner = new Spinner(this);
        ArrayAdapter<String> adapter = new ArrayAdapter<String>(this, android.R.layout.simple_spinner_dropdown_item, values) {
            @Override public View getView(int position, View convertView, ViewGroup parent) {
                TextView view = (TextView) super.getView(position, convertView, parent);
                view.setTextColor(Color.WHITE);
                view.setTextSize(16);
                view.setPadding(Ui.dp(MainActivity.this, 14), 0, Ui.dp(MainActivity.this, 10), 0);
                return view;
            }
        };
        spinner.setAdapter(adapter);
        spinner.setBackground(Ui.gradient(new int[]{Color.rgb(17, 21, 34), Color.rgb(13, 16, 27)}, Ui.dp(this, 14)));
        return spinner;
    }

    private static void addStrings(LinkedHashSet<String> output, JSONArray input) {
        if (input == null) return;
        for (int i = 0; i < input.length(); i++) {
            String value = input.optString(i);
            if (!value.isEmpty()) output.add(value);
        }
    }

    private void toggleRecording() {
        if (recording) stopRecording(); else startRecording();
    }

    private void startRecording() {
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, AUDIO_PERMISSION);
            return;
        }
        try {
            recordingFile = new File(getCacheDir(), "agent-voice-" + System.currentTimeMillis() + ".m4a");
            recorder = Build.VERSION.SDK_INT >= 31 ? new MediaRecorder(this) : new MediaRecorder();
            recorder.setAudioSource(MediaRecorder.AudioSource.MIC);
            recorder.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4);
            recorder.setAudioEncoder(MediaRecorder.AudioEncoder.AAC);
            recorder.setAudioSamplingRate(44_100);
            recorder.setAudioEncodingBitRate(96_000);
            recorder.setOutputFile(recordingFile.getAbsolutePath());
            recorder.prepare();
            recorder.start();
            recording = true;
            micButton.setText("■  Stop");
            micButton.setTextColor(Color.rgb(255, 105, 124));
            notice.setText("Listening… tap Stop when you're done.");
        } catch (Exception exception) {
            releaseRecorder();
            notice.setText("Microphone: " + message(exception));
        }
    }

    private void stopRecording() {
        recording = false;
        micButton.setText("…  Transcribing");
        micButton.setEnabled(false);
        notice.setText("Converting speech to text…");
        try {
            recorder.stop();
            recorder.release();
            recorder = null;
        } catch (RuntimeException exception) {
            releaseRecorder();
            micButton.setEnabled(true);
            micButton.setText("●  Speak");
            notice.setText("Recording too short: try again and speak for at least one second.");
            return;
        }
        File finished = recordingFile;
        io.execute(() -> {
            try {
                byte[] bytes = Files.readAllBytes(finished.toPath());
                if (bytes.length < 1024) throw new IllegalStateException("The recording is empty.");
                String text = api.transcribe(bytes).trim();
                if (text.isEmpty()) throw new IllegalStateException("No words recognized. Try again closer to the microphone.");
                runOnUiThread(() -> {
                    String previous = promptField.getText().toString().trim();
                    promptField.setText(previous.isEmpty() ? text : previous + " " + text);
                    promptField.setSelection(promptField.length());
                    notice.setText("Transcription ready.");
                    resetMicButton();
                });
            } catch (Exception exception) {
                runOnUiThread(() -> {
                    if (showLoginIfExpired(exception)) return;
                    notice.setText("Transcription: " + message(exception));
                    resetMicButton();
                });
            } finally {
                if (finished != null) finished.delete();
            }
        });
    }

    private void resetMicButton() {
        micButton.setEnabled(true);
        micButton.setText("●  Speak");
        micButton.setTextColor(Color.WHITE);
    }

    private void releaseRecorder() {
        if (recorder != null) {
            try { recorder.release(); } catch (Exception ignored) {}
        }
        recorder = null;
        recording = false;
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(requestCode, permissions, results);
        if (requestCode != AUDIO_PERMISSION) return;
        if (results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED) {
            startRecording();
        } else if (!shouldShowRequestPermissionRationale(Manifest.permission.RECORD_AUDIO)) {
            notice.setText("Enable the microphone in Android Settings.");
            Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getPackageName()));
            startActivity(intent);
        } else {
            notice.setText("Microphone permission is required for dictation.");
        }
    }

    private void hideKeyboard() {
        View focused = getCurrentFocus();
        if (focused != null) ((InputMethodManager) getSystemService(INPUT_METHOD_SERVICE)).hideSoftInputFromWindow(focused.getWindowToken(), 0);
    }

    private boolean showLoginIfExpired(Exception exception) {
        Throwable cause = exception;
        while (cause != null) {
            if (cause instanceof ApiClient.UnauthorizedException) {
                Toast.makeText(this, "Session expired: sign in again.", Toast.LENGTH_LONG).show();
                showLogin();
                return true;
            }
            cause = cause.getCause();
        }
        return false;
    }

    static String message(Exception exception) {
        Throwable cause = exception;
        while (cause.getCause() != null) cause = cause.getCause();
        String message = cause.getMessage();
        return message == null || message.isEmpty() ? "Operation failed." : message;
    }

    @Override
    protected void onDestroy() {
        releaseRecorder();
        io.shutdownNow();
        super.onDestroy();
    }
}
