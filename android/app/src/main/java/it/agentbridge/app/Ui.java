package it.agentbridge.app;

import android.content.Context;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;

final class Ui {
    static final int INK = Color.rgb(7, 10, 18);
    static final int PANEL = Color.rgb(20, 24, 38);
    static final int CYAN = Color.rgb(49, 215, 255);
    static final int VIOLET = Color.rgb(140, 99, 255);
    static final int MUTED = Color.rgb(163, 173, 194);

    private Ui() {}

    static int dp(Context context, int value) {
        return Math.round(value * context.getResources().getDisplayMetrics().density);
    }

    static GradientDrawable gradient(int[] colors, float radius) {
        GradientDrawable drawable = new GradientDrawable(GradientDrawable.Orientation.TL_BR, colors);
        drawable.setCornerRadius(radius);
        return drawable;
    }

    static GradientDrawable panel(Context context) {
        GradientDrawable drawable = gradient(new int[]{Color.rgb(27, 31, 48), Color.rgb(13, 17, 29)}, dp(context, 24));
        drawable.setStroke(dp(context, 1), Color.argb(65, 255, 255, 255));
        return drawable;
    }

    static TextView text(Context context, String value, float size, int color) {
        TextView view = new TextView(context);
        view.setText(value);
        view.setTextSize(size);
        view.setTextColor(color);
        view.setFontFeatureSettings("kern");
        return view;
    }

    static TextView title(Context context, String value, float size) {
        TextView view = text(context, value, size, Color.WHITE);
        view.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        return view;
    }

    static EditText field(Context context, String hint) {
        EditText view = new EditText(context);
        view.setHint(hint);
        view.setHintTextColor(Color.rgb(110, 120, 143));
        view.setTextColor(Color.WHITE);
        view.setSingleLine(true);
        view.setTextSize(16);
        view.setPadding(dp(context, 16), dp(context, 4), dp(context, 16), dp(context, 4));
        GradientDrawable bg = gradient(new int[]{Color.rgb(17, 21, 34), Color.rgb(13, 16, 27)}, dp(context, 14));
        bg.setStroke(dp(context, 1), Color.rgb(49, 58, 79));
        view.setBackground(bg);
        view.setMinHeight(dp(context, 54));
        return view;
    }

    static Button button(Context context, String label, boolean accent) {
        Button view = new Button(context);
        view.setText(label);
        view.setTextColor(Color.WHITE);
        view.setTextSize(15);
        view.setAllCaps(false);
        view.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        view.setBackground(gradient(
                accent ? new int[]{VIOLET, Color.rgb(78, 78, 229)} : new int[]{Color.rgb(39, 46, 66), Color.rgb(26, 31, 46)},
                dp(context, 16)));
        view.setMinHeight(dp(context, 54));
        return view;
    }

    static LinearLayout.LayoutParams params(int width, int height, int top) {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(width, height);
        params.topMargin = top;
        return params;
    }

    static void enabled(ViewGroup root, boolean enabled) {
        for (int i = 0; i < root.getChildCount(); i++) {
            View child = root.getChildAt(i);
            child.setEnabled(enabled);
            if (child instanceof ViewGroup) enabled((ViewGroup) child, enabled);
        }
    }
}
