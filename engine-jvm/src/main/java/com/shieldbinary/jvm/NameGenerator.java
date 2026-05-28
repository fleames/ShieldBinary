package com.shieldbinary.jvm;

public class NameGenerator {
    private int counter = 0;
    private static final char[] CHARS;

    static {
        StringBuilder sb = new StringBuilder();
        for (char c = 'A'; c <= 'Z'; c++) sb.append(c);
        for (char c = 'a'; c <= 'z'; c++) sb.append(c);
        CHARS = sb.toString().toCharArray();
    }

    // Returns a JAR-entry-style internal name like "a/A", "a/B", ... "a/z", "a/AA", ...
    public String next() {
        return "a/" + encode(counter++);
    }

    private String encode(int n) {
        StringBuilder sb = new StringBuilder();
        do {
            sb.append(CHARS[n % CHARS.length]);
            n = n / CHARS.length - 1;
        } while (n >= 0);
        return sb.reverse().toString();
    }
}
