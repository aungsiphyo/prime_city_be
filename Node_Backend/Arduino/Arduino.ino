#include <Servo.h>

// ========== No1: Ultrasonic + IR + Servo Gate ==========
#define TRIG_PIN 2
#define IR_PIN 3
#define ECHO_PIN 4
#define SERVO_PIN 5

Servo gateServo;

int gateCloseAngle = 0;
int gateOpenAngle  = 90;

int entryDetectCM = 8;
int exitDetectCM  = 4;
int stableNeeded = 2;
int stableCount = 0;

unsigned long closeDelay = 1500;

enum GateMode {
  IDLE,
  ENTRY_OPEN,
  EXIT_OPEN
};

GateMode gateMode = IDLE;


// ========== No2: LDR Module + PWM MOSFET Street Light ==========
#define STREET_LDR A0
#define STREET_PWM 6

int streetThreshold = 500;
bool darkWhenValueLow = false;


// ========== No3: Solar Tracker with Servo ==========
#define SOLAR_LEFT_LDR  A1
#define SOLAR_RIGHT_LDR A2
#define SOLAR_SERVO_PIN 10

Servo solarServo;

int solarThreshold = 80;

int solarAngle = 90;
int solarMinAngle = 20;
int solarMaxAngle = 160;

int solarStep = 1;          // 1 degree per move
int solarMoveDelay = 60;    // bigger = slower


void setup() {
  Serial.begin(9600);

  pinMode(TRIG_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);
  pinMode(IR_PIN, INPUT);

  gateServo.attach(SERVO_PIN);
  closeGate();

  pinMode(STREET_PWM, OUTPUT);

  solarServo.attach(SOLAR_SERVO_PIN);
  solarServo.write(solarAngle);

  Serial.println("System Ready");
}


void loop() {
  handleGate();
  handleStreetLight();
  handleSolarTracker();

  delay(100);
}


// =================================================
// No1: Entry/Exit Gate
// =================================================
void handleGate() {
  long distance = getDistanceCM();

  bool entryDetected = false;
  bool exitDetected = false;

  if (distance > 4 && distance <= entryDetectCM) {
    entryDetected = true;
  }

  if (distance > 1 && distance <= exitDetectCM) {
    exitDetected = true;
  }

  bool irDetected = (digitalRead(IR_PIN) == LOW);

  if (gateMode == IDLE && entryDetected) {
    stableCount++;

    if (stableCount >= stableNeeded) {
      openGate();
      gateMode = ENTRY_OPEN;
      stableCount = 0;
      Serial.println("ENTRY OPEN");
    }
  }

  else if (gateMode == IDLE && irDetected) {
    openGate();
    gateMode = EXIT_OPEN;
    stableCount = 0;
    Serial.println("EXIT OPEN");
  }

  else if (gateMode == IDLE) {
    stableCount = 0;
  }

  if (gateMode == ENTRY_OPEN && irDetected) {
    delay(closeDelay);
    closeGate();
    gateMode = IDLE;
    Serial.println("ENTRY CLOSED");
  }

  if (gateMode == EXIT_OPEN && exitDetected) {
    delay(closeDelay);
    closeGate();
    gateMode = IDLE;
    Serial.println("EXIT CLOSED");
  }
}


long getDistanceCM() {
  digitalWrite(TRIG_PIN, LOW);
  delayMicroseconds(2);

  digitalWrite(TRIG_PIN, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG_PIN, LOW);

  long duration = pulseIn(ECHO_PIN, HIGH, 30000);

  if (duration == 0) return 999;

  return duration * 0.034 / 2;
}


void openGate() {
  gateServo.write(gateOpenAngle);
  Serial.println("Gate Open");
}


void closeGate() {
  gateServo.write(gateCloseAngle);
  Serial.println("Gate Closed");
}


// =================================================
// No2: Auto Street Light
// =================================================
void handleStreetLight() {
  int ldrValue = analogRead(STREET_LDR);

  bool isDark;

  if (darkWhenValueLow) {
    isDark = ldrValue < streetThreshold;
  } else {
    isDark = ldrValue > streetThreshold;
  }

  if (isDark) {
    digitalWrite(STREET_PWM, HIGH);
  } else {
    digitalWrite(STREET_PWM, LOW);
  }
}


// =================================================
// No3: Solar Tracker with Slow Servo
// =================================================
void handleSolarTracker() {
  int leftValue = analogRead(SOLAR_LEFT_LDR);
  int rightValue = analogRead(SOLAR_RIGHT_LDR);

  int diff = leftValue - rightValue;

  if (diff > solarThreshold) {
    moveSolarLeftSlow();
  }
  else if (diff < -solarThreshold) {
    moveSolarRightSlow();
  }
  else {
    stopSolarServo();
  }

  Serial.print("Left: ");
  Serial.print(leftValue);
  Serial.print(" | Right: ");
  Serial.print(rightValue);
  Serial.print(" | Diff: ");
  Serial.print(diff);
  Serial.print(" | Angle: ");
  Serial.println(solarAngle);
}


void moveSolarLeftSlow() {
  solarAngle += solarStep;

  if (solarAngle > solarMaxAngle) {
    solarAngle = solarMaxAngle;
  }

  solarServo.write(solarAngle);
  delay(solarMoveDelay);
}


void moveSolarRightSlow() {
  solarAngle -= solarStep;

  if (solarAngle < solarMinAngle) {
    solarAngle = solarMinAngle;
  }

  solarServo.write(solarAngle);
  delay(solarMoveDelay);
}


void stopSolarServo() {
  solarServo.write(solarAngle);
}