/* Copyright notice goes here, as in any real keymap.c */
#include QMK_KEYBOARD_H

// Layer names
enum layers {
    _QWERTY,   // base
    _LOWER,    /* numbers + navigation */
    _RAISE = 2,
    _ADJUST,
};

#define LOWER  MO(_LOWER)
#define RAISE  MO(_RAISE)
#define SPC_LO LT(_LOWER, KC_SPC)
#define HM_A   LGUI_T(KC_A)
#define HM_S   LALT_T(KC_S)
#define HM_L   RALT_T(KC_L)
#define HM_SC  MT(MOD_RGUI, KC_SCLN)
#define CTL_ESC LCTL_T(KC_ESC)  // tap Esc
#define BTN_X  KC_BTN1

const uint16_t PROGMEM keymaps[][MATRIX_ROWS][MATRIX_COLS] = {
    [_QWERTY] = LAYOUT_split_3x5_3(
        KC_Q, KC_W,  KC_E,    KC_R,   KC_T,       KC_Y,   KC_U,    KC_I,    KC_O,   KC_P,
        HM_A, HM_S,  KC_D,    KC_F,   KC_G,       KC_H,   KC_J,    KC_K,    HM_L,   HM_SC,
        KC_Z, KC_X,  KC_C,    KC_V,   KC_B,       KC_N,   KC_M,    KC_COMM, KC_DOT, KC_SLSH,
                     CTL_ESC, SPC_LO, OSM(MOD_LSFT),  KC_ENT, RAISE, KC_MPLY
    ),
    [_LOWER] = LAYOUT_split_3x5_3(
        KC_1,    KC_2,    KC_3,    KC_4,    KC_5,       KC_6,    KC_7,    KC_8,    KC_9,    KC_0,
        _______, KC_LEFT, KC_DOWN, KC_UP,   KC_RGHT,    KC_MINS, KC_EQL,  KC_LBRC, KC_RBRC, TG(_ADJUST),
        _______, XXXXXXX, XXXXXXX, XXXXXXX, XXXXXXX,    BTN_X,   KC_HOME, KC_PGDN, KC_PGUP, KC_END,
                          _______, _______, _______,    _______, _______, _______
    ),
    [_RAISE] = LAYOUT_split_3x5_3(
        KC_EXLM, KC_AT,   KC_HASH, KC_DLR,  KC_PERC,    KC_CIRC, KC_AMPR, KC_ASTR, KC_LPRN, KC_RPRN,
        _______, KC_UNDS, KC_PLUS, KC_LCBR, KC_RCBR,    KC_BSLS, KC_PIPE, S(KC_QUOT), KC_COLN, TG(_ADJUST),
        _______, _______, _______, _______, _______,    KC_TILD, KC_GRV,  KC_LABK, KC_RABK, KC_QUES,
                          _______, _______, _______,    _______, _______, _______
    ),
    [_ADJUST] = LAYOUT_split_3x5_3(
        QK_BOOT, RGB_TOG, RGB_MOD, RGB_HUI, RGB_SAI,    XXXXXXX, KC_F1,   KC_F2,   KC_F3,   KC_F4,
        XXXXXXX, XXXXXXX, XXXXXXX, XXXXXXX, XXXXXXX,    XXXXXXX, KC_F5,   KC_F6,   KC_F7,   KC_F8,
        XXXXXXX, XXXXXXX, XXXXXXX, XXXXXXX, XXXXXXX,    XXXXXXX, KC_F9,   KC_F10,  KC_F11,  KC_F12,
                          _______, _______, _______,    _______, _______, _______
    )
};
