// ESP32 PORT NOTES (read before uploading):
// 1) Install "ESP32Servo" library via Arduino IDE Library Manager (original
// Servo.h does not work on ESP32). 2) Tools > Board > select your ESP32 Dev
// Module. 3) ESP32 GPIOs are 3.3V logic, NOT 5V tolerant. If your HC-SR04 ECHO
// pin or IR sensor output
//    is 5V, use a voltage divider / logic level shifter before connecting to
//    ESP32 GPIO.
// 4) analogWrite() is replaced with ledcWrite() for ESP32 compatibility.
// 5) FIX (servo not moving): both servos and the street-light PWM were fighting
//    over the same LEDC timer. ESP32 LEDC has only 4 timers per speed group and
//    every 2 channels share 1 timer - if the 1000Hz street-light channel lands
//    on the same timer as a 50Hz servo channel, the timer's frequency gets
//    overwritten and the servo pulse train breaks for BOTH servos. Fix: reserve
//    a dedicated timer before attaching servos, and attach both servos BEFORE
//    the street-light ledcAttach() call.
#include <ESP32Servo.h>

// =============================================================
// Smart Residential System - ESP32 Controller
// Modules:
//   No1 - Ultrasonic + IR + Servo Gate (Entry/Exit)
//   No2 - LDR + PWM MOSFET Auto Street Light (with gradual dim)
//   No3 - Dual-LDR Solar Tracker with slow Servo
// =============================================================

// ==================== No1: Gate System =======================
#define TRIG_PIN 5   // ESP32: was 2 (avoids boot-strapping pin)
#define IR_PIN 19    // ESP32: was 3
#define ECHO_PIN 18  // ESP32: was 4
#define SERVO_PIN 13 // ESP32: was 5

Servo gateServo;

// --- Gate Angles ---
const int GATE_CLOSE_ANGLE = 0;
const int GATE_OPEN_ANGLE = 90;

// --- Detection Thresholds ---
const int ENTRY_DETECT_CM = 8; // Object 5..8 cm -> entry car incoming
const int EXIT_DETECT_CM = 4;  // Object <=4 cm -> car exiting gate area

// --- Debounce / Stability ---
const int STABLE_NEEDED = 2; // Consecutive reads needed before opening
int stableCount = 0;

// --- Timing ---
const unsigned long CLOSE_DELAY_MS = 1500; // Wait before closing gate (ms)
const unsigned long ENTRY_TIMEOUT_MS =
    10000; // FIX: Max time gate stays open for ENTRY
           // (IR miss-fire kaukwya, security risk ul shi)

// --- State Machine ---
enum GateMode {
  IDLE,
  ENTRY_OPEN,
  EXIT_OPEN,
  WAIT_CLEAR // Wait until no vehicle is detected before going IDLE
};
GateMode gateMode = IDLE;

// --- Non-blocking close timer ---
bool closeTimerActive = false;
unsigned long closeTimerStart = 0;

// Minimum time gate stays open before the EXIT close timer is allowed to start.
// Prevents instant-close if the IR beam is only briefly broken (car hasn't
// fully passed) right at the moment the gate opens.
const unsigned long EXIT_HOLD_MS = 800; // ms gate must stay open for EXIT mode
unsigned long exitOpenTime = 0;         // time when EXIT_OPEN state was entered

// FIX: Entry open timestamp for timeout guard
unsigned long entryOpenTime = 0;

// ==================== No2: Street Light ======================
#define STREET_LDR                                                             \
  34 // ESP32: was A0 (ADC1_CH6, input-only pin, fine for analogRead)
#define STREET_PWM 25 // ESP32: was 6 (pin 6-11 reserved for flash on ESP32)

// FIX: LEDC channel settings for ESP32 (replaces analogWrite)
#define STREET_LEDC_FREQ 1000 // Hz
#define STREET_LEDC_RES 8     // bits (0-255)

const int STREET_THRESHOLD =
    500; // LDR raw value (0-1023, see analogReadResolution below)
const bool DARK_WHEN_LOW = false; // false = dark when LDR value is HIGH

// Gradual dimming: ramp speed
const int LIGHT_RAMP_STEP = 5;
int currentBrightness = 0;

// ==================== No3: Solar Tracker =====================
#define SOLAR_LEFT_LDR 35  // ESP32: was A1 (ADC1_CH7)
#define SOLAR_RIGHT_LDR 32 // ESP32: was A2 (ADC1_CH4)
#define SOLAR_SERVO_PIN 27 // ESP32: was 10

Servo solarServo;

const int SOLAR_THRESHOLD = 80; // Min diff to trigger movement
const int SOLAR_MIN_ANGLE = 20;
const int SOLAR_MAX_ANGLE = 160;
const int SOLAR_STEP = 1;        // Degrees per servo step
const int SOLAR_MOVE_DELAY = 40; // ms between servo steps

int solarAngle = 90;
unsigned long lastSolarMove = 0;

// ⚡ POWER GUARD
const unsigned long SERVO_STAGGER_MS = 20;
unsigned long lastGateServoMove = 0;

// ==================== Main Loop Timing =======================
unsigned long lastLoopRun = 0;
const unsigned long LOOP_INTERVAL = 50;

// =============================================================
void setup() {
  Serial.begin(115200);

  // ESP32: match Uno's 10-bit ADC range (0-1023) so STREET_THRESHOLD /
  // SOLAR_THRESHOLD stay valid unchanged. ESP32 ADC defaults to 12-bit (0-4095)
  // otherwise.
  analogReadResolution(10);

  // Gate pins
  pinMode(TRIG_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);
  pinMode(IR_PIN, INPUT_PULLUP);

  // FIX: reserve a dedicated LEDC timer BEFORE either servo attaches, so the
  // street-light's 1000Hz channel (attached further below) is pushed onto a
  // timer that neither servo is using. Without this, the auto-allocator can
  // place the 1000Hz channel on the same timer as a 50Hz servo channel, which
  // silently rewrites that timer's frequency and breaks the servo's pulses.
  ESP32PWM::allocateTimer(3);

  // FIX: setPeriodHertz(50) locks each servo channel to standard 50Hz before
  // attach, and explicit 500-2400us pulse range is safer across servo brands
  // than the library default.
  gateServo.setPeriodHertz(50);
  gateServo.attach(SERVO_PIN, 500, 2400);
  closeGate();

  // Solar tracker - attached here (still before street light PWM) so both
  // servos claim their timers first.
  solarServo.setPeriodHertz(50);
  solarServo.attach(SOLAR_SERVO_PIN, 500, 2400);
  solarServo.write(solarAngle);

  // FIX: Street light - use ledcAttach + ledcWrite instead of analogWrite for
  // ESP32. Moved to AFTER both servo attach() calls (see timer-sharing note
  // above).
  ledcAttach(STREET_PWM, STREET_LEDC_FREQ, STREET_LEDC_RES);
  ledcWrite(STREET_PWM, 0);

  Serial.println(F("=== Smart Residential System Ready ==="));
}

// =============================================================
void loop() {
  if (millis() - lastLoopRun >= LOOP_INTERVAL) {
    lastLoopRun = millis();
    handleGate();
    handleStreetLight();
    handleSolarTracker();
  }
}

// =============================================================
// No1: Entry / Exit Gate Handler
// =============================================================
void handleGate() {
  long distance = 999;

  // FIX: Gate ပွင့်နေတဲ့အချိန်တွေမှာ pulseIn() ကြောင့် Solar Tracker တုန်ခါ/နှေးကွေးခြင်းမှ
  // ကာကွယ်ရန် Gate အပိတ် (IDLE) နှင့် ကားရှင်းမရှင်းစစ်ဆေးချိန် (WAIT_CLEAR) တွင်သာ Ultrasonic
  // ဖတ်မည်။
  if (gateMode == IDLE || gateMode == WAIT_CLEAR) {
    distance = getDistanceCM();
  }

  bool irDetected = (digitalRead(IR_PIN) == LOW);

  bool entryDetected = (distance >= 5 && distance <= ENTRY_DETECT_CM);
  bool exitDetected = (distance >= 1 && distance <= EXIT_DETECT_CM);

  // ---------- WAIT_CLEAR: wait for vehicle to fully clear ----------
  if (gateMode == WAIT_CLEAR) {
    if (!entryDetected && !exitDetected && !irDetected) {
      gateMode = IDLE;
      stableCount = 0;
      Serial.println(F("Gate area cleared -> IDLE"));
    }
    return;
  }

  // ---------- ENTRY detection ----------
  if (gateMode == IDLE && entryDetected) {
    stableCount++;
    if (stableCount >= STABLE_NEEDED) {
      openGate();
      gateMode = ENTRY_OPEN;
      stableCount = 0;
      entryOpenTime = millis(); // FIX: record entry open time for timeout guard
      Serial.println(F("ENTRY OPEN"));
    }
  }
  // ---------- EXIT detection ----------
  else if (gateMode == IDLE && irDetected) {
    openGate();
    gateMode = EXIT_OPEN;
    stableCount = 0;
    exitOpenTime = millis(); // Record when gate opened for EXIT hold guard
    Serial.println(F("EXIT OPEN"));
  } else if (gateMode == IDLE) {
    stableCount = 0;
  }

  // ---------- Start close timer after car passes ----------
  if (gateMode == ENTRY_OPEN && irDetected && !closeTimerActive) {
    closeTimerActive = true;
    closeTimerStart = millis();
    Serial.println(F("Entry car passed IR -> starting close timer"));
  }

  // FIX: ENTRY TIMEOUT GUARD
  // IR sensor miss-fire ဖြစ်ရင် Gate ထာဝရ ဖွင့်မနေအောင် timeout ထည့်ထားတယ်။
  // Security risk ကာကွယ်ချက်။
  if (gateMode == ENTRY_OPEN && !closeTimerActive &&
      (millis() - entryOpenTime >= ENTRY_TIMEOUT_MS)) {
    closeTimerActive = true;
    closeTimerStart = millis();
    Serial.println(F("Entry timeout -> force close timer started"));
  }

  // EXIT mode: start timer only after car fully clears AND hold time elapsed.
  // EXIT_HOLD_MS guard prevents instant-close the moment gate opens.
  if (gateMode == EXIT_OPEN && !exitDetected && !irDetected &&
      !closeTimerActive && (millis() - exitOpenTime >= EXIT_HOLD_MS)) {
    closeTimerActive = true;
    closeTimerStart = millis();
    Serial.println(F("Exit car cleared -> starting close timer"));
  }

  // ---------- Execute close after delay ----------
  if (closeTimerActive && (millis() - closeTimerStart >= CLOSE_DELAY_MS)) {
    closeGate();

    if (gateMode == ENTRY_OPEN)
      Serial.println(F("ENTRY CLOSED"));
    if (gateMode == EXIT_OPEN)
      Serial.println(F("EXIT CLOSED"));

    gateMode = WAIT_CLEAR;
    closeTimerActive = false;
  }
}

// --- Ultrasonic distance measurement ---
long getDistanceCM() {
  digitalWrite(TRIG_PIN, LOW);
  delayMicroseconds(2);
  digitalWrite(TRIG_PIN, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG_PIN, LOW);

  // FIX: timeout 15000 -> 8000us (max ~138cm range, reduces blocking from 15ms
  // to 8ms) Solar Tracker smoothness တိုးတက်မည်
  long duration = pulseIn(ECHO_PIN, HIGH, 8000);
  if (duration == 0)
    return 999;
  return duration / 58;
}

void openGate() {
  gateServo.write(GATE_OPEN_ANGLE);
  lastGateServoMove = millis();
  Serial.println(F("-> Gate OPEN"));
}

void closeGate() {
  gateServo.write(GATE_CLOSE_ANGLE);
  lastGateServoMove = millis();
  Serial.println(F("-> Gate CLOSED"));
}

// =============================================================
// No2: Auto Street Light with Smooth PWM Dimming
// =============================================================
void handleStreetLight() {
  int ldrValue = analogRead(STREET_LDR);
  bool isDark = DARK_WHEN_LOW ? (ldrValue < STREET_THRESHOLD)
                              : (ldrValue > STREET_THRESHOLD);

  int targetBrightness = isDark ? 255 : 0;

  if (currentBrightness < targetBrightness) {
    currentBrightness =
        min(currentBrightness + LIGHT_RAMP_STEP, targetBrightness);
  } else if (currentBrightness > targetBrightness) {
    currentBrightness =
        max(currentBrightness - LIGHT_RAMP_STEP, targetBrightness);
  }

  // FIX: ledcWrite() replaces analogWrite() for ESP32 compatibility
  ledcWrite(STREET_PWM, currentBrightness);
}

// =============================================================
// No3: Solar Tracker with Non-blocking Slow Servo
// =============================================================
void handleSolarTracker() {
  int leftValue = analogRead(SOLAR_LEFT_LDR);
  int rightValue = analogRead(SOLAR_RIGHT_LDR);
  int diff = leftValue - rightValue;

  if (diff > SOLAR_THRESHOLD) {
    moveSolarSlow(+SOLAR_STEP);
  } else if (diff < -SOLAR_THRESHOLD) {
    moveSolarSlow(-SOLAR_STEP);
  }

  static unsigned long lastDebugPrint = 0;
  if (millis() - lastDebugPrint >= 500) {
    lastDebugPrint = millis();
    Serial.print(F("Solar | L:"));
    Serial.print(leftValue);
    Serial.print(F(" R:"));
    Serial.print(rightValue);
    Serial.print(F(" Diff:"));
    Serial.print(diff);
    Serial.print(F(" Angle:"));
    Serial.println(solarAngle);
  }
}

void moveSolarSlow(int step) {
  unsigned long now = millis();
  // ⚡ POWER GUARD
  if (now - lastGateServoMove < SERVO_STAGGER_MS)
    return;
  if (now - lastSolarMove >= (unsigned long)SOLAR_MOVE_DELAY) {
    solarAngle = constrain(solarAngle + step, SOLAR_MIN_ANGLE, SOLAR_MAX_ANGLE);
    solarServo.write(solarAngle);
    lastSolarMove = now;
  }
}
