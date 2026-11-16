// Corne default-style keymap (hand written for tests)
#include QMK_KEYBOARD_H

enum layers { _QWERTY, _LOWER, _RAISE };

const uint16_t PROGMEM keymaps[][MATRIX_ROWS][MATRIX_COLS] = {
  [_QWERTY] = LAYOUT_split_3x6_3(
  KC_TAB, KC_Q, KC_W, KC_E, KC_R, KC_T,   KC_Y, KC_U, KC_I, KC_O, KC_P, KC_BSPC,
  KC_LCTL, KC_A, KC_S, KC_D, KC_F, KC_G,   KC_H, KC_J, KC_K, KC_L, KC_SCLN, KC_QUOT,
  KC_LSFT, KC_Z, KC_X, KC_C, KC_V, KC_B,   KC_N, KC_M, KC_COMM, KC_DOT, KC_SLSH, KC_ESC,
                    KC_LGUI, MO(1), KC_SPC,   KC_ENT, LT(2, KC_SPC), KC_RALT
  ),
  [_LOWER] = LAYOUT_split_3x6_3(
  KC_TAB, KC_1, KC_2, KC_3, KC_4, KC_5,   KC_6, KC_7, KC_8, KC_9, KC_0, KC_BSPC,
  _______, KC_LEFT, KC_DOWN, KC_UP, KC_RGHT, XXXXXXX,   KC_MINS, KC_EQL, KC_LBRC, KC_RBRC, KC_BSLS, KC_GRV,
  _______, XXXXXXX, XXXXXXX, XXXXXXX, XXXXXXX, XXXXXXX,   XXXXXXX, XXXXXXX, KC_COMM, KC_DOT, KC_SLSH, _______,
                    _______, _______, _______,   _______, _______, _______
  ),
  [_RAISE] = LAYOUT_split_3x6_3(
  KC_TAB, KC_EXLM, KC_AT, KC_HASH, KC_DLR, KC_PERC,   KC_CIRC, KC_AMPR, KC_ASTR, KC_LPRN, KC_RPRN, KC_BSPC,
  _______, KC_UNDS, KC_PLUS, KC_LCBR, KC_RCBR, KC_PIPE,   KC_TILD, S(KC_SCLN), KC_DQUO, KC_LABK, KC_RABK, KC_QUES,
  _______, _______, _______, _______, _______, _______,   _______, _______, _______, _______, _______, _______,
                    _______, _______, _______,   _______, _______, _______
  )
};
