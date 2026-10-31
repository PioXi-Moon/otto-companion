/*
 * Otto 单文件烧录版 v1，经典 Nano / ATmega328P。
 * 全部程序已合并在这个 .ino 中，不需要旁边的 .h/.cpp。
 * Servo 是启用舵机时使用的 Arduino 库；舵机、点阵、声控已开启。
 * 接线尚未确认，先验证程序；这份文件不能烧到小智板。
 * 由 firmware/tests/make_single_file.py 从维护版生成。
 */
#include <Arduino.h>
#include <avr/pgmspace.h>
#include <string.h>


// 舵机引脚已按板上原厂演示程序核对：D2/D3/D4/D5 四个舵机。
// 点阵与声控按商家参考引脚开启，正在实测；超声波、蓝牙保持关闭。
#ifndef OTTO_ENABLE_SERVOS
#define OTTO_ENABLE_SERVOS 1
#endif
#ifndef OTTO_ENABLE_MAX7219
#define OTTO_ENABLE_MAX7219 1
#endif
#ifndef OTTO_ENABLE_SOUND
#define OTTO_ENABLE_SOUND 1
#endif
#ifndef OTTO_ENABLE_ULTRASONIC
#define OTTO_ENABLE_ULTRASONIC 0
#endif
#ifndef OTTO_ENABLE_BUZZER
#define OTTO_ENABLE_BUZZER 0
#endif
#ifndef OTTO_INPUT_BLUETOOTH
#define OTTO_INPUT_BLUETOOTH 0
#endif
#if OTTO_INPUT_BLUETOOTH
#ifndef OTTO_BT_BAUD
#error "Set the verified Bluetooth baud rate; do not assume 9600."
#endif
#define OTTO_LINK_BAUD OTTO_BT_BAUD
#else
#define OTTO_LINK_BAUD 115200UL
#endif

#ifndef OTTO_PIN_LEFT_LEG
#define OTTO_PIN_LEFT_LEG 2
#endif
#ifndef OTTO_PIN_RIGHT_LEG
#define OTTO_PIN_RIGHT_LEG 3
#endif
#ifndef OTTO_PIN_LEFT_FOOT
#define OTTO_PIN_LEFT_FOOT 4
#endif
#ifndef OTTO_PIN_RIGHT_FOOT
#define OTTO_PIN_RIGHT_FOOT 5
#endif
#ifndef OTTO_PIN_TRIG
#define OTTO_PIN_TRIG 8
#endif
#ifndef OTTO_PIN_ECHO
#define OTTO_PIN_ECHO 9
#endif
#ifndef OTTO_PIN_BUZZER
#define OTTO_PIN_BUZZER 13
#endif

namespace hw {
const uint8_t servoPins[4] = {OTTO_PIN_LEFT_LEG, OTTO_PIN_RIGHT_LEG,
                            OTTO_PIN_LEFT_FOOT, OTTO_PIN_RIGHT_FOOT};
const int8_t servoDirection[4] = {1, 1, 1, 1};
uint8_t matrixDin = A3, matrixCs = A2, matrixClk = A1;
const uint8_t matrixRotation = 1;
const bool matrixMirror = false;
const uint8_t soundPin = A6;
// 声控模块输出约 300 Hz 的 PWM：用占空比相对基线的偏移判断拍手。
const uint16_t soundMidpoint = 512;
const uint16_t soundWindowMs = 50, soundDeviationPermille = 160;
const uint16_t soundCooldownMs = 250;
const uint8_t trigPin = OTTO_PIN_TRIG, echoPin = OTTO_PIN_ECHO;
const uint8_t buzzerPin = OTTO_PIN_BUZZER;
const uint16_t distanceIntervalMs = 150;
const uint32_t echoTimeoutUs = 25000UL;
}

static_assert(hw::matrixRotation < 4, "Rotation must be 0..3");
static_assert(hw::soundDeviationPermille > 0 && hw::soundWindowMs > 0,
              "Invalid sound detector settings");


#if OTTO_ENABLE_SERVOS
#include <Servo.h>
#endif
#if !defined(__AVR_ATmega328P__)
#error "Select the classic Arduino Nano ATmega328P."
#endif


enum class VoiceState : uint8_t { IDLE, LISTENING, THINKING, SPEAKING };
enum class Action : uint8_t {
  NONE, HOME, SWING, WAVE, TWIST, STOMP, BOW, SHAKE, SIT, DANCE, HAPPY, GREET,
  WALK, BACK, LEFT, RIGHT, BOUNCE, WIGGLE
};

struct DistanceReading {
  bool valid;
  uint16_t cm;
  unsigned long measuredAt;
};

const __FlashStringHelper* actionName(Action a);
const __FlashStringHelper* voiceName(VoiceState v);
inline const __FlashStringHelper* actionName(Action a) {
  switch (a) {
    case Action::HOME: return F("HOME");
    case Action::SWING: return F("SWING");
    case Action::WAVE: return F("WAVE");
    case Action::TWIST: return F("TWIST");
    case Action::STOMP: return F("STOMP");
    case Action::BOW: return F("BOW");
    case Action::SHAKE: return F("SHAKE");
    case Action::SIT: return F("SIT");
    case Action::DANCE: return F("DANCE");
    case Action::WALK: return F("WALK");
    case Action::BACK: return F("BACK");
    case Action::LEFT: return F("LEFT");
    case Action::RIGHT: return F("RIGHT");
    case Action::BOUNCE: return F("BOUNCE");
    case Action::WIGGLE: return F("WIGGLE");
    case Action::HAPPY: return F("HAPPY");
    case Action::GREET: return F("GREET");
    default: return F("IDLE");
  }
}
inline const __FlashStringHelper* voiceName(VoiceState v) {
  switch (v) {
    case VoiceState::LISTENING: return F("LISTENING");
    case VoiceState::THINKING: return F("THINKING");
    case VoiceState::SPEAKING: return F("SPEAKING");
    default: return F("IDLE");
  }
}

namespace face_data {
// 与 config/led_face_presets.json 对应：睁眼、闭眼、开心、说话、熄屏。
// 最上行在前，最高位代表最左点；存 Flash，避免占用 Nano 的有限 SRAM。
const uint8_t presets[][8] PROGMEM = {
  {0,0,0x66,0x66,0,0,0,0},
  {0,0,0,0x66,0,0,0,0},
  {0,0,0x24,0x5A,0,0x42,0x3C,0},
  {0,0,0x66,0x66,0,0x18,0x18,0},
  {0,0,0,0,0,0,0,0},
  {0x00,0x24,0x24,0x00,0x42,0x3C,0x00,0x00},
  {0x00,0x81,0x42,0x24,0x00,0x3C,0x42,0x00},
  {0x30,0x10,0x20,0x18,0x00,0x00,0x00,0x00},
  {0x00,0x24,0x24,0x00,0x18,0x24,0x18,0x00},
  {0x00,0x66,0xFF,0xFF,0x7E,0x3C,0x18,0x00},
  {0x18,0x18,0x7E,0x3C,0x3C,0x66,0x42,0x00},
  {0x00,0x00,0x66,0x00,0x00,0x42,0x3C,0x00}
};
}

namespace bluetooth {
// 蓝牙与电脑／小智使用同一个已选 UART 入口，不创建第二个软件串口。
// 这是换行 ASCII 指令模式，不声称兼容尚未取得协议的商家手机 App。
inline const __FlashStringHelper* selectedInputName() {
#if OTTO_INPUT_BLUETOOTH
  return F("BLUETOOTH_TEXT");
#else
  return F("HOST");
#endif
}
}

namespace control {
void controlLinkBegin();
void controlLinkPoll();
void replyError(const __FlashStringHelper* error);
void replyOk(const char* command);
}

namespace motion {
void motionConfigure();
bool motionStart(Action action, unsigned long now);
bool motionUpdate(unsigned long now); // true：本次动作程序完成
void motionStop(bool release);
bool motionIsBusy();
bool motionIsArmed();
void motionServo(uint8_t index, uint8_t angle);
}

namespace matrix {
void matrixBegin();
void matrixDrawFrame(const uint8_t rows[8]);
void matrixSelfTest();
void matrixSetPins(uint8_t din, uint8_t cs, uint8_t clk);
}

namespace face {
void faceBegin();
bool faceSet(const char* name);
bool faceAnim(const char* name);
void faceSetFrame(const uint8_t rows[8]);
void faceSetQuiet(bool quiet);
void faceSetVoice(VoiceState voice);
void faceBlink(unsigned long now);
void faceUpdate(unsigned long now);
void facePrintFrame();
}

namespace sound {
void soundBegin(unsigned long now);
bool soundUpdate(unsigned long now, bool allowed);
uint16_t soundLatest();
void soundSetSensitivity(uint16_t permille);
}

namespace distance {
void distanceBegin(unsigned long now);
void distanceUpdate(unsigned long now);
DistanceReading distanceLatest(unsigned long now);
}

namespace behavior {
bool behaviorBegin();
void behaviorUpdate(unsigned long now);
void behaviorCommand(char* command);
void behaviorFrame(const uint8_t rows[8], const char* command);
}

namespace router {
void routeCommand(char* command);
}

// Module: control
namespace control {
using router::routeCommand;
namespace {
char line[48];
uint8_t used = 0;
bool invalid = false;
}

void replyError(const __FlashStringHelper* error) {
  Serial.print(F("ERR ")); Serial.println(error);
}
void replyOk(const char* command) {
  Serial.print(F("OK ")); Serial.println(command);
}
void controlLinkBegin() { Serial.begin(OTTO_LINK_BAUD); }

void controlLinkPoll() {
  // 限制每轮输入工作量，让动作、传感器和停止请求都得到处理。
  for (uint8_t count = 0; count < 16 && Serial.available(); ++count) {
    char c = static_cast<char>(Serial.read());
    if (c == '\n') {
      line[used] = '\0';
      if (invalid) replyError(F("INVALID_OR_LONG_LINE"));
      else if (used) routeCommand(line);
      used = 0; invalid = false;
    } else if (c == '\r') {
      // CRLF
    } else if (c < 32 || c > 126 || used >= sizeof(line) - 1) {
      invalid = true; // 丢弃整行；不执行溢出前缀。
    } else if (!invalid) {
      if (c >= 'a' && c <= 'z') c -= 'a' - 'A';
      line[used++] = c;
    }
  }
}
}

// Module: motion
namespace motion {

#if OTTO_ENABLE_SERVOS

#endif

namespace {
#if OTTO_ENABLE_SERVOS
Servo servos[4];
#endif
bool attached = false, armed = false, busy = false;
Action current = Action::NONE;
uint8_t segment = 0;
uint8_t nextServo = 0;
unsigned long segmentAt = 0, lastWrite = 0, startedAt = 0;
int16_t position[4] = {90, 90, 90, 90};
int16_t origin[4], target[4];

// 每帧 4 个增量：左腿、右腿、左脚、右脚，均相对 90°。
struct Plan { const int8_t* frames; uint8_t count; uint16_t ms; };
const int8_t planHome[]  PROGMEM = {0,0,0,0};
const int8_t planSwing[] PROGMEM = {0,0,25,25, 0,0,0,0, 0,0,-25,-25, 0,0,0,0,
                                    0,0,25,25, 0,0,0,0, 0,0,-25,-25, 0,0,0,0};
const int8_t planWave[]  PROGMEM = {0,0,22,22, 0,0,0,0, 0,0,-22,-22, 0,0,0,0,
                                    0,0,22,22, 0,0,0,0, 0,0,-22,-22, 0,0,0,0};
const int8_t planTwist[] PROGMEM = {0,0,15,-15, 0,0,0,0, 0,0,-15,15, 0,0,0,0};
const int8_t planStomp[] PROGMEM = {0,0,12,12, 0,0,0,0, 0,0,-10,-10, 0,0,0,0};
const int8_t planBow[]   PROGMEM = {0,0,20,20, 0,0,0,0};
const int8_t planShake[] PROGMEM = {8,-8,0,0, -8,8,0,0, 8,-8,0,0, -8,8,0,0, 0,0,0,0};
const int8_t planSit[]   PROGMEM = {14,14,-16,-16};
const int8_t planDance[] PROGMEM = {0,0,12,12, 0,0,-12,12, 0,0,-12,-12,
                                    0,0,12,-12, 6,-6,0,0, -6,6,0,0, 0,0,0,0};
/*
 * Walking follows the OttoDIY oscillator gait: both hips are in phase,
 * both feet are in phase, and the feet lead the hips by 90 degrees.  The
 * previous arrays moved the feet against each other and therefore only
 * tipped the body instead of transferring weight between the two feet.
 *
 * Each row below is a sample of three complete gait cycles followed by a
 * return-to-home row.  Sampling avoids trigonometry on the ATmega328P and
 * keeps the motion update path unchanged.
 */
const int8_t planWalk[] PROGMEM = {
   0,  0,-16,-24,  11, 11,-14,-22,  21, 21,-10,-18,  28, 28, -4,-12,
  30, 30,  4, -4,  28, 28, 12,  4,  21, 21, 18, 10,  11, 11, 22, 14,
   0,  0, 24, 16, -11,-11, 22, 14, -21,-21, 18, 10, -28,-28, 12,  4,
 -30,-30,  4, -4, -28,-28, -4,-12, -21,-21,-10,-18, -11,-11,-14,-22,
   0,  0,-16,-24,  11, 11,-14,-22,  21, 21,-10,-18,  28, 28, -4,-12,
  30, 30,  4, -4,  28, 28, 12,  4,  21, 21, 18, 10,  11, 11, 22, 14,
   0,  0, 24, 16, -11,-11, 22, 14, -21,-21, 18, 10, -28,-28, 12,  4,
 -30,-30,  4, -4, -28,-28, -4,-12, -21,-21,-10,-18, -11,-11,-14,-22,
   0,  0,-16,-24,  11, 11,-14,-22,  21, 21,-10,-18,  28, 28, -4,-12,
  30, 30,  4, -4,  28, 28, 12,  4,  21, 21, 18, 10,  11, 11, 22, 14,
   0,  0, 24, 16, -11,-11, 22, 14, -21,-21, 18, 10, -28,-28, 12,  4,
 -30,-30,  4, -4, -28,-28, -4,-12, -21,-21,-10,-18, -11,-11,-14,-22,
   0,  0,  0,  0
};
const int8_t planBack[] PROGMEM = {
   0,  0, 24, 16,  11, 11, 22, 14,  21, 21, 18, 10,  28, 28, 12,  4,
  30, 30,  4, -4,  28, 28, -4,-12,  21, 21,-10,-18,  11, 11,-14,-22,
   0,  0,-16,-24, -11,-11,-14,-22, -21,-21,-10,-18, -28,-28, -4,-12,
 -30,-30,  4, -4, -28,-28, 12,  4, -21,-21, 18, 10, -11,-11, 22, 14,
   0,  0, 24, 16,  11, 11, 22, 14,  21, 21, 18, 10,  28, 28, 12,  4,
  30, 30,  4, -4,  28, 28, -4,-12,  21, 21,-10,-18,  11, 11,-14,-22,
   0,  0,-16,-24, -11,-11,-14,-22, -21,-21,-10,-18, -28,-28, -4,-12,
 -30,-30,  4, -4, -28,-28, 12,  4, -21,-21, 18, 10, -11,-11, 22, 14,
   0,  0, 24, 16,  11, 11, 22, 14,  21, 21, 18, 10,  28, 28, 12,  4,
  30, 30,  4, -4,  28, 28, -4,-12,  21, 21,-10,-18,  11, 11,-14,-22,
   0,  0,-16,-24, -11,-11,-14,-22, -21,-21,-10,-18, -28,-28, -4,-12,
 -30,-30,  4, -4, -28,-28, 12,  4, -21,-21, 18, 10, -11,-11, 22, 14,
   0,  0,  0,  0
};
const int8_t planLeft[] PROGMEM = {
   0,  0,-16,-24,  11,  4,-14,-22,  21,  7,-10,-18,  28,  9, -4,-12,
  30, 10,  4, -4,  28,  9, 12,  4,  21,  7, 18, 10,  11,  4, 22, 14,
   0,  0, 24, 16, -11, -4, 22, 14, -21, -7, 18, 10, -28, -9, 12,  4,
 -30,-10,  4, -4, -28, -9, -4,-12, -21, -7,-10,-18, -11, -4,-14,-22,
   0,  0,-16,-24,  11,  4,-14,-22,  21,  7,-10,-18,  28,  9, -4,-12,
  30, 10,  4, -4,  28,  9, 12,  4,  21,  7, 18, 10,  11,  4, 22, 14,
   0,  0, 24, 16, -11, -4, 22, 14, -21, -7, 18, 10, -28, -9, 12,  4,
 -30,-10,  4, -4, -28, -9, -4,-12, -21, -7,-10,-18, -11, -4,-14,-22,
   0,  0,-16,-24,  11,  4,-14,-22,  21,  7,-10,-18,  28,  9, -4,-12,
  30, 10,  4, -4,  28,  9, 12,  4,  21,  7, 18, 10,  11,  4, 22, 14,
   0,  0, 24, 16, -11, -4, 22, 14, -21, -7, 18, 10, -28, -9, 12,  4,
 -30,-10,  4, -4, -28, -9, -4,-12, -21, -7,-10,-18, -11, -4,-14,-22,
   0,  0,  0,  0
};
const int8_t planRight[] PROGMEM = {
   0,  0,-16,-24,   4, 11,-14,-22,   7, 21,-10,-18,   9, 28, -4,-12,
  10, 30,  4, -4,   9, 28, 12,  4,   7, 21, 18, 10,   4, 11, 22, 14,
   0,  0, 24, 16,  -4,-11, 22, 14,  -7,-21, 18, 10,  -9,-28, 12,  4,
 -10,-30,  4, -4,  -9,-28, -4,-12,  -7,-21,-10,-18,  -4,-11,-14,-22,
   0,  0,-16,-24,   4, 11,-14,-22,   7, 21,-10,-18,   9, 28, -4,-12,
  10, 30,  4, -4,   9, 28, 12,  4,   7, 21, 18, 10,   4, 11, 22, 14,
   0,  0, 24, 16,  -4,-11, 22, 14,  -7,-21, 18, 10,  -9,-28, 12,  4,
 -10,-30,  4, -4,  -9,-28, -4,-12,  -7,-21,-10,-18,  -4,-11,-14,-22,
   0,  0,-16,-24,   4, 11,-14,-22,   7, 21,-10,-18,   9, 28, -4,-12,
  10, 30,  4, -4,   9, 28, 12,  4,   7, 21, 18, 10,   4, 11, 22, 14,
   0,  0, 24, 16,  -4,-11, 22, 14,  -7,-21, 18, 10,  -9,-28, 12,  4,
 -10,-30,  4, -4,  -9,-28, -4,-12,  -7,-21,-10,-18,  -4,-11,-14,-22,
   0,  0,  0,  0
};
const int8_t planBounce[] PROGMEM = {-8,-8,0,0, 0,0,0,0, -8,-8,0,0, 0,0,0,0,
                                    -8,-8,0,0, 0,0,0,0, -8,-8,0,0, 0,0,0,0};
const int8_t planWiggle[] PROGMEM = {0,0,14,-14, 0,0,-14,14, 0,0,14,-14, 0,0,-14,14, 0,0,0,0,
                                    0,0,14,-14, 0,0,-14,14, 0,0,14,-14, 0,0,-14,14, 0,0,0,0};

Plan planFor(Action a) {
  switch (a) {
    case Action::SWING: return {planSwing, 8, 400};
    case Action::WAVE:  return {planWave, 8, 420};
    case Action::TWIST: return {planTwist, 4, 450};
    case Action::STOMP: return {planStomp, 4, 260};
    case Action::BOW:   return {planBow, 2, 500};
    case Action::SHAKE: return {planShake, 5, 120};
    case Action::SIT:   return {planSit, 1, 600};
    case Action::DANCE: return {planDance, 7, 480};
    // 16 samples per 1200 ms step, repeated three times, then HOME.
    case Action::WALK:  return {planWalk, 49, 75};
    case Action::BACK:  return {planBack, 49, 75};
    case Action::LEFT:  return {planLeft, 49, 75};
    case Action::RIGHT: return {planRight, 49, 75};
    case Action::BOUNCE: return {planBounce, 8, 160};
    case Action::WIGGLE: return {planWiggle, 10, 140};
    case Action::HAPPY: return {planSwing, 8, 400};
    case Action::GREET: return {planWave, 8, 420};
    default:            return {planHome, 1, 500};
  }
}

void writePosition(uint8_t index) {
#if OTTO_ENABLE_SERVOS
  if (index > 3) return;
  int angle = 90 + (position[index] - 90) * hw::servoDirection[index];
  servos[index].write(constrain(angle, 60, 120));
#else
  (void)index;
#endif
}
void writePosition() {
  for (uint8_t i = 0; i < 4; ++i) writePosition(i);
}
Plan plan;
void setSegment() {
  plan = planFor(current);
  const uint8_t index = segment < plan.count ? segment : plan.count - 1;
  for (uint8_t i = 0; i < 4; ++i) {
    origin[i] = position[i];
    int16_t delta = static_cast<int8_t>(pgm_read_byte(plan.frames + index * 4 + i));
    // The reference gait is too aggressive for the current USB-powered build.
    // Keep the verified phase relationship, but reduce hip torque and foot lift.
    if (current == Action::WALK || current == Action::BACK ||
        current == Action::LEFT || current == Action::RIGHT) {
      delta = delta * (i < 2 ? 800 : 600) / 1000;
    }
    target[i] = 90 + delta;
  }
}
}

void motionConfigure() {
  // 保持未连接状态；只有 HOME 才 attach。
  attached = armed = busy = false;
}
bool motionStart(Action action, unsigned long now) {
#if !OTTO_ENABLE_SERVOS
  (void)action; (void)now; return false;
#else
  if (busy || action == Action::NONE || (action != Action::HOME && !armed)) return false;
  if (!attached) {
    for (uint8_t i = 0; i < 4; ++i) {
      position[i] = 90;
      servos[i].write(90);
      servos[i].attach(hw::servoPins[i]);
      delay(120); // 逐个上电，避免四个舵机同时起转把 5V 拉垮。
    }
    attached = true;
  }
  current = action; busy = true; armed = false; startedAt = now;
  nextServo = 0;
  segment = 0; segmentAt = now; lastWrite = now - 20;
  setSegment(); return true;
#endif
}
bool motionUpdate(unsigned long now) {
  if (!busy) return false;
  if (now - startedAt > 25000UL) {
    busy = false; armed = true; current = Action::NONE;
    return true; // 看门狗：任何动作超过 25 秒强制收尾，避免永久卡死。
  }
  const uint16_t duration = plan.ms;
  const unsigned long elapsed = now - segmentAt;
  const bool travel = current == Action::WALK || current == Action::BACK ||
                      current == Action::LEFT || current == Action::RIGHT;
  if (elapsed < duration && now - lastWrite < (travel ? 5 : 20)) return false;
  lastWrite = now;
  const uint16_t progress = elapsed >= duration ? duration : elapsed;
  // 连续线性插值：帧与帧之间不停顿，走起来更连贯。
  for (uint8_t i = 0; i < 4; ++i)
    position[i] = origin[i] + static_cast<int32_t>(target[i] - origin[i]) * progress / duration;
  if (travel) writePosition((nextServo++) & 3);
  else writePosition();
  if (elapsed < duration) return false;
  if (++segment >= plan.count) {
    busy = false; armed = true; current = Action::NONE;
    return true;
  }
  segmentAt = now; setSegment(); return false;
}
void motionStop(bool release) {
  busy = armed = false; current = Action::NONE;
#if OTTO_ENABLE_SERVOS
  if (release && attached) {
    for (uint8_t i = 0; i < 4; ++i) {
      servos[i].detach();
      digitalWrite(hw::servoPins[i], LOW);
      pinMode(hw::servoPins[i], INPUT);
    }
    attached = false;
  }
#else
  (void)release;
#endif
}
bool motionIsBusy() { return busy; }
bool motionIsArmed() { return armed; }
void motionServo(uint8_t index, uint8_t angle) {
#if OTTO_ENABLE_SERVOS
  if (index > 3) return;
  busy = armed = false; current = Action::NONE;
  if (!servos[index].attached()) servos[index].attach(hw::servoPins[index]);
  servos[index].write(constrain(angle, 0, 180));
  position[index] = angle;
  attached = true;
#else
  (void)index; (void)angle;
#endif
}
}

// Module: matrix
namespace matrix {

namespace {
#if OTTO_ENABLE_MAX7219
void writeRegister(uint8_t address, uint8_t value) {
  digitalWrite(hw::matrixCs, LOW);
  shiftOut(hw::matrixDin, hw::matrixClk, MSBFIRST, address);
  shiftOut(hw::matrixDin, hw::matrixClk, MSBFIRST, value);
  digitalWrite(hw::matrixCs, HIGH);
}
#endif
}
void matrixBegin() {
#if OTTO_ENABLE_MAX7219
  pinMode(hw::matrixDin, OUTPUT); pinMode(hw::matrixClk, OUTPUT);
  pinMode(hw::matrixCs, OUTPUT); digitalWrite(hw::matrixCs, HIGH);
  digitalWrite(hw::matrixClk, LOW);
  writeRegister(0x0C, 0); writeRegister(0x0F, 0);
  writeRegister(0x09, 0); writeRegister(0x0B, 7); writeRegister(0x0A, 10);
  const uint8_t blank[8] = {}; matrixDrawFrame(blank); writeRegister(0x0C, 1);
#endif
}
void matrixSelfTest() {
#if OTTO_ENABLE_MAX7219
  writeRegister(0x0F, 1);
  delay(1200);
  writeRegister(0x0F, 0);
#endif
}
void matrixSetPins(uint8_t din, uint8_t cs, uint8_t clk) {
  hw::matrixDin = din; hw::matrixCs = cs; hw::matrixClk = clk;
  pinMode(din, OUTPUT); pinMode(cs, OUTPUT); pinMode(clk, OUTPUT);
  matrixBegin();
}
void matrixDrawFrame(const uint8_t rows[8]) {
#if OTTO_ENABLE_MAX7219
  uint8_t output[8] = {};
  for (uint8_t y = 0; y < 8; ++y) for (uint8_t x = 0; x < 8; ++x) {
    if (!(rows[y] & (0x80 >> x))) continue;
    uint8_t xx = x, yy = y;
    for (uint8_t r = hw::matrixRotation; r > 0; --r) {
      const uint8_t oldX = xx; xx = 7 - yy; yy = oldX;
    }
    if (hw::matrixMirror) xx = 7 - xx;
    output[yy] |= 0x80 >> xx;
  }
  for (uint8_t y = 0; y < 8; ++y) writeRegister(y + 1, output[y]);
#else
  (void)rows;
#endif
}
}

// Module: face
namespace face {
using matrix::matrixBegin;
using matrix::matrixDrawFrame;
namespace {
enum class Anim : uint8_t { NONE, SCAN, WAVE, SPIN, HEARTBEAT };
uint8_t base[8], displayed[8];
bool quiet = false, blinking = false, dirty = true;
VoiceState voice = VoiceState::IDLE;
unsigned long blinkAt = 0;
Anim anim = Anim::NONE;
unsigned long animAt = 0;
void copyPreset(uint8_t index, uint8_t out[8]) { memcpy_P(out, face_data::presets[index], 8); }
}
void faceBegin() { copyPreset(0, base); matrixBegin(); dirty = true; faceUpdate(millis()); }
bool faceSet(const char* name) {
  uint8_t index;
  if (!strcmp(name, "CALM")) index = 0;
  else if (!strcmp(name, "BLINK")) index = 1;
  else if (!strcmp(name, "SMILE")) index = 2;
  else if (!strcmp(name, "TALKING")) index = 3;
  else if (!strcmp(name, "OFF")) index = 4;
  else if (!strcmp(name, "HAPPY")) index = 5;
  else if (!strcmp(name, "ANGRY")) index = 6;
  else if (!strcmp(name, "SLEEP")) index = 7;
  else if (!strcmp(name, "SURPRISE")) index = 8;
  else if (!strcmp(name, "HEART")) index = 9;
  else if (!strcmp(name, "STAR")) index = 10;
  else if (!strcmp(name, "WINK")) index = 11;
  else return false;
  copyPreset(index, base); blinking = false; anim = Anim::NONE; dirty = true; return true;
}
bool faceAnim(const char* name) {
  if (!strcmp(name, "SCAN")) anim = Anim::SCAN;
  else if (!strcmp(name, "WAVE")) anim = Anim::WAVE;
  else if (!strcmp(name, "SPIN")) anim = Anim::SPIN;
  else if (!strcmp(name, "HEARTBEAT")) anim = Anim::HEARTBEAT;
  else if (!strcmp(name, "STOP")) anim = Anim::NONE;
  else return false;
  animAt = millis(); blinking = false; dirty = true; return true;
}
void faceSetFrame(const uint8_t rows[8]) {
  memcpy(base, rows, 8); blinking = false; dirty = true;
}
void faceSetQuiet(bool value) { quiet = value; blinking = false; dirty = true; }
void faceSetVoice(VoiceState value) { voice = value; blinking = false; dirty = true; }
void faceBlink(unsigned long now) { if (!quiet) { blinking = true; blinkAt = now; } }
void faceUpdate(unsigned long now) {
  if (anim != Anim::NONE) {
    uint8_t rows[8] = {};
    const unsigned long t = now - animAt;
    switch (anim) {
      case Anim::SCAN: {
        const uint8_t x = (t / 80) % 8;
        for (uint8_t y = 0; y < 8; ++y) rows[y] = 0x80 >> x;
        if (t > 1600) anim = Anim::NONE;
        break;
      }
      case Anim::WAVE: {
        const uint8_t phase = (t / 90) % 8;
        for (uint8_t y = 0; y < 8; ++y) rows[y] = 0x80 >> ((y + phase) % 8);
        if (t > 2400) anim = Anim::NONE;
        break;
      }
      case Anim::SPIN: {
        const uint8_t step = (t / 100) % 8;
        for (uint8_t i = 0; i < 8; ++i) rows[i] = 0x80 >> ((i + step) % 8);
        if (t > 2000) anim = Anim::NONE;
        break;
      }
      case Anim::HEARTBEAT: {
        copyPreset((t / 220) % 2 ? 9 : 4, rows);
        if (t > 1800) anim = Anim::NONE;
        break;
      }
      default: break;
    }
    matrixDrawFrame(rows);
    memcpy(displayed, rows, 8);
    dirty = false;
    return;
  }
  uint8_t next[8];
  if (blinking && now - blinkAt >= 250) blinking = false;
  if (quiet || blinking) copyPreset(1, next);
  else if (voice == VoiceState::SPEAKING) copyPreset((now / 250) % 2 ? 3 : 0, next);
  else if (voice == VoiceState::LISTENING || voice == VoiceState::THINKING) copyPreset(0, next);
  else memcpy(next, base, 8);
  if (dirty || memcmp(next, displayed, 8)) {
    memcpy(displayed, next, 8); matrixDrawFrame(displayed); dirty = false;
  }
}
void facePrintFrame() {
  for (uint8_t i = 0; i < 8; ++i) {
    if (displayed[i] < 16) Serial.print('0');
    Serial.print(displayed[i], HEX);
  }
  Serial.println();
}
}

// Module: sfx
namespace sfx {
namespace {
struct Note { uint16_t freq; uint16_t ms; };
const Note bootNotes[]    PROGMEM = {{880,70},{1175,70},{1568,120}};
const Note happyNotes[]   PROGMEM = {{1047,60},{1319,60},{1568,140}};
const Note sadNotes[]     PROGMEM = {{784,100},{587,160}};
const Note alertNotes[]   PROGMEM = {{1568,60},{0,50},{1568,60},{0,50},{1568,140}};
const Note clickNotes[]   PROGMEM = {{2000,20}};
const Note successNotes[] PROGMEM = {{880,60},{1320,60},{1760,180}};
const Note errorNotes[]   PROGMEM = {{300,120},{200,200}};

const Note* notes = nullptr;
uint8_t count = 0, index = 0;
uint16_t noteMs = 0;
unsigned long noteAt = 0;
bool active = false, playing = false;

void playCurrent() {
  Note n; memcpy_P(&n, notes + index, sizeof(Note));
  noteMs = n.ms; noteAt = millis(); playing = true;
  if (n.freq) tone(hw::buzzerPin, n.freq); else noTone(hw::buzzerPin);
}

void start(const Note* table, uint8_t total) {
  notes = table; count = total; index = 0;
  active = true; playing = false;
}
}

void sfxBegin() {
#if OTTO_ENABLE_BUZZER
  pinMode(hw::buzzerPin, OUTPUT);
  digitalWrite(hw::buzzerPin, LOW);
#endif
}
bool sfxPlayNamed(const char* name) {
#if !OTTO_ENABLE_BUZZER
  (void)name; return false;
#else
  if (!strcmp(name, "BOOT")) start(bootNotes, 3);
  else if (!strcmp(name, "HAPPY")) start(happyNotes, 3);
  else if (!strcmp(name, "SAD")) start(sadNotes, 2);
  else if (!strcmp(name, "ALERT")) start(alertNotes, 5);
  else if (!strcmp(name, "CLICK")) start(clickNotes, 1);
  else if (!strcmp(name, "SUCCESS")) start(successNotes, 3);
  else if (!strcmp(name, "ERROR")) start(errorNotes, 2);
  else return false;
  return true;
#endif
}
void sfxUpdate(unsigned long now) {
#if OTTO_ENABLE_BUZZER
  if (!active) return;
  if (!playing) { playCurrent(); return; }
  if (now - noteAt < noteMs) return;
  if (++index >= count) {
    noTone(hw::buzzerPin); active = playing = false;
    return;
  }
  playCurrent();
#else
  (void)now;
#endif
}
}

// Module: sound
namespace sound {

namespace {
unsigned long sampledAt = 0, windowAt = 0, lastEvent = 0;
uint16_t highSamples = 0, totalSamples = 0;
int16_t baselinePermille = 0;
uint16_t deviationPermille = hw::soundDeviationPermille;
bool baselineReady = false;
uint16_t latest = 0;
}
void soundBegin(unsigned long now) {
  highSamples = totalSamples = 0; baselineReady = false;
  sampledAt = windowAt = now;
  lastEvent = now - hw::soundCooldownMs;
}
bool soundUpdate(unsigned long now, bool allowed) {
#if OTTO_ENABLE_SOUND
  // A6 只能模拟读取；2 ms 采一次，算 50 ms 窗口内的占空比。
  if (now - sampledAt < 2) return false;
  sampledAt = now; latest = analogRead(hw::soundPin);
  ++totalSamples;
  if (latest >= hw::soundMidpoint) ++highSamples;
  if (now - windowAt < hw::soundWindowMs) return false;

  const int16_t permille = totalSamples
      ? static_cast<int16_t>(static_cast<uint32_t>(highSamples) * 1000 / totalSamples)
      : baselinePermille;
  highSamples = totalSamples = 0; windowAt = now;
  if (!baselineReady) { baselinePermille = permille; baselineReady = true; return false; }

  const int16_t diff = permille - baselinePermille;
  const uint16_t magnitude = static_cast<uint16_t>(diff >= 0 ? diff : -diff);
  if (allowed && magnitude >= deviationPermille &&
      now - lastEvent >= hw::soundCooldownMs) {
    lastEvent = now; return true;
  }
  baselinePermille = static_cast<int16_t>(baselinePermille + diff / 16);
#else
  (void)now; (void)allowed;
#endif
  return false;
}
uint16_t soundLatest() { return latest; }
void soundSetSensitivity(uint16_t permille) {
  deviationPermille = permille < 50 ? 50 : (permille > 600 ? 600 : permille);
}
}

// Module: distance
namespace distance {

namespace {
enum class Phase : uint8_t { IDLE, TRIG_LOW, TRIG_HIGH, WAIT_RISE, WAIT_FALL };
Phase phase = Phase::IDLE;
unsigned long startedMs = 0;
DistanceReading reading = {false, 0, 0};
#if OTTO_ENABLE_ULTRASONIC
unsigned long phaseUs = 0, riseUs = 0;
void finish(bool valid, unsigned long now, uint16_t cm = 0) {
  reading = {valid, cm, now}; phase = Phase::IDLE;
}
#endif
}
void distanceBegin(unsigned long now) {
  startedMs = now; phase = Phase::IDLE;
#if OTTO_ENABLE_ULTRASONIC
  digitalWrite(hw::trigPin, LOW); pinMode(hw::trigPin, OUTPUT);
  pinMode(hw::echoPin, INPUT);
#endif
}
void distanceUpdate(unsigned long now) {
#if OTTO_ENABLE_ULTRASONIC
  const unsigned long us = micros();
  switch (phase) {
    case Phase::IDLE:
      if (now - startedMs >= hw::distanceIntervalMs) {
        startedMs = now; phaseUs = us; digitalWrite(hw::trigPin, LOW);
        phase = Phase::TRIG_LOW;
      }
      break;
    case Phase::TRIG_LOW:
      if (us - phaseUs >= 2) {
        digitalWrite(hw::trigPin, HIGH); phaseUs = us; phase = Phase::TRIG_HIGH;
      }
      break;
    case Phase::TRIG_HIGH:
      if (us - phaseUs >= 10) {
        digitalWrite(hw::trigPin, LOW); phaseUs = us; phase = Phase::WAIT_RISE;
      }
      break;
    case Phase::WAIT_RISE:
      if (us - phaseUs >= hw::echoTimeoutUs) finish(false, now);
      else if (digitalRead(hw::echoPin) == HIGH) {
        riseUs = us; phase = Phase::WAIT_FALL;
      }
      break;
    case Phase::WAIT_FALL:
      if (us - riseUs >= hw::echoTimeoutUs) finish(false, now);
      else if (digitalRead(hw::echoPin) == LOW) {
        const uint16_t cm = (us - riseUs) / 58;
        finish(cm >= 2 && cm <= 400, now, cm);
      }
      break;
  }
#else
  (void)now;
#endif
}
DistanceReading distanceLatest(unsigned long now) {
  DistanceReading result = reading;
  if (now - result.measuredAt > hw::distanceIntervalMs * 3UL) result.valid = false;
  return result;
}
}

// Module: behavior
namespace behavior {
using control::controlLinkBegin;
using control::controlLinkPoll;
using control::replyError;
using control::replyOk;
using motion::motionConfigure;
using motion::motionStart;
using motion::motionUpdate;
using motion::motionStop;
using motion::motionIsBusy;
using motion::motionIsArmed;
using face::faceBegin;
using face::faceSet;
using face::faceSetFrame;
using face::faceSetQuiet;
using face::faceSetVoice;
using face::faceBlink;
using face::faceUpdate;
using face::facePrintFrame;
using sound::soundBegin;
using sound::soundUpdate;
using sound::soundLatest;
using distance::distanceBegin;
using distance::distanceUpdate;
using distance::distanceLatest;
using bluetooth::selectedInputName;
namespace {
bool configValid = false, quiet = false, events = false, soundEnabled = true;
bool restoreCalm = false;
VoiceState voice = VoiceState::IDLE;
Action active = Action::NONE;
unsigned long distanceReportAt = 0;
uint8_t soundBurst = 0;
unsigned long soundBurstAt = 0;
unsigned long soundMuteUntil = 0;

const uint8_t kQueueSize = 4;
Action queue[kQueueSize];
uint8_t queueHead = 0, queueCount = 0;

bool enqueueAction(Action action) {
  if (queueCount >= kQueueSize) return false;
  queue[(queueHead + queueCount) % kQueueSize] = action;
  ++queueCount;
  return true;
}
bool dequeueAction(Action& out) {
  if (!queueCount) return false;
  out = queue[queueHead];
  queueHead = (queueHead + 1) % kQueueSize;
  --queueCount;
  return true;
}
void clearQueue() { queueHead = 0; queueCount = 0; }

bool validatePins() {
  uint8_t pins[12], count = 0;
#if OTTO_ENABLE_SERVOS
  for (uint8_t i = 0; i < 4; ++i) {
    pins[count++] = hw::servoPins[i];
    if (hw::servoDirection[i] != 1 && hw::servoDirection[i] != -1) {
      Serial.print(F("BADTRIM ")); Serial.println(i);
      return false;
    }
  }
#endif
#if OTTO_ENABLE_MAX7219
  pins[count++] = hw::matrixDin; pins[count++] = hw::matrixCs; pins[count++] = hw::matrixClk;
#endif
#if OTTO_ENABLE_ULTRASONIC
  pins[count++] = hw::trigPin; pins[count++] = hw::echoPin;
#endif
  for (uint8_t i = 0; i < count; ++i) {
    if (pins[i] < 2 || pins[i] > A5) {
      Serial.print(F("BADPIN ")); Serial.println(pins[i]);
      return false;
    }
    for (uint8_t j = 0; j < i; ++j) if (pins[i] == pins[j]) {
      Serial.print(F("DUPPIN ")); Serial.println(pins[i]);
      return false;
    }
  }
#if OTTO_ENABLE_SOUND
  if (hw::soundPin < A0 || hw::soundPin > A7) {
    Serial.print(F("BADSOUND ")); Serial.println(hw::soundPin);
    return false;
  }
  for (uint8_t i = 0; i < count; ++i) if (pins[i] == hw::soundPin) {
    Serial.print(F("DUPSOUND ")); Serial.println(hw::soundPin);
    return false;
  }
#endif
  return true;
}
void cancelMotion(bool release) {
  if (active != Action::NONE) {
    Serial.print(F("ERR CANCELLED ")); Serial.println(actionName(active));
  }
  motionStop(release); active = Action::NONE;
  clearQueue();
  if (restoreCalm) faceSet("CALM");
  restoreCalm = false;
}
void triggerSoundAction(uint8_t count) {
  if (count < 2 || quiet || voice != VoiceState::IDLE || motionIsBusy()) return;
  if (!motionIsArmed()) {
    if (motionStart(Action::HOME, millis())) active = Action::HOME;
    return;
  }
  Action action;
  const char* faceName;
  if (count == 2) { action = Action::SWING; faceName = "SMILE"; }
  else if (count == 3) { action = Action::WAVE; faceName = "HAPPY"; }
  else { action = Action::DANCE; faceName = "HEART"; }
  if (!motionStart(action, millis())) return;
  active = action;
  soundMuteUntil = millis() + 700;
  faceSet(faceName);
  restoreCalm = true;
  Serial.print(F("EVENT ACTION ")); Serial.println(actionName(action));
}
void printDistance(unsigned long now) {
#if OTTO_ENABLE_ULTRASONIC
  const DistanceReading d = distanceLatest(now);
  if (d.valid) Serial.println(d.cm);
  else Serial.println(F("INVALID"));
#else
  (void)now; Serial.println(F("DISABLED"));
#endif
}
void printInfo() {
  if (configValid) faceUpdate(millis());
  Serial.println(F("FIRMWARE otto_controller v1"));
  Serial.println(configValid ? F("CONFIG VALID") : F("CONFIG INVALID"));
  Serial.print(F("INPUT ")); Serial.println(selectedInputName());
  Serial.println(OTTO_ENABLE_MAX7219 ? F("DISPLAY MAX7219") : F("DISPLAY NONE"));
  Serial.println(F("TOUCH DISABLED")); // 兼容电脑显示连接的能力查询
  Serial.println(OTTO_ENABLE_SERVOS ? F("SERVOS ENABLED") : F("SERVOS DISABLED"));
  Serial.println(OTTO_ENABLE_SOUND ? F("SOUND ANALOG") : F("SOUND DISABLED"));
  Serial.println(OTTO_ENABLE_ULTRASONIC ? F("ULTRASONIC PULSE") : F("ULTRASONIC DISABLED"));
  Serial.print(F("BUZZER ")); Serial.println(OTTO_ENABLE_BUZZER ? hw::buzzerPin : 0);
  Serial.println(quiet ? F("MODE QUIET") : F("MODE NORMAL"));
  Serial.print(F("VOICE ")); Serial.println(voiceName(voice));
  Serial.print(F("MOTION ")); Serial.println(actionName(active));
  Serial.print(F("ARMED ")); Serial.println(motionIsArmed() ? 1 : 0);
  Serial.print(F("QUEUE ")); Serial.println(queueCount);
  Serial.println(events ? F("EVENTS ON") : F("EVENTS OFF"));
  Serial.print(F("FRAME ")); facePrintFrame();
  Serial.println(F("INFO_END"));
}
void beginAction(Action action) {
  if (!motionStart(action, millis())) { replyError(F("MOTION_REJECTED")); return; }
  active = action;
  soundMuteUntil = millis() + 700;
  if (action == Action::HAPPY) {
    faceSet("HAPPY"); restoreCalm = true; sfx::sfxPlayNamed("HAPPY");
  } else if (action == Action::GREET) {
    faceSet("WINK"); restoreCalm = true; sfx::sfxPlayNamed("HAPPY");
  } else if (action == Action::STOMP) {
    faceSet("ANGRY"); restoreCalm = true; sfx::sfxPlayNamed("ALERT");
  } else if (action == Action::SIT) {
    faceSet("SLEEP"); restoreCalm = true; sfx::sfxPlayNamed("SAD");
  } else if (action == Action::DANCE) {
    faceSet("HAPPY"); restoreCalm = true; sfx::sfxPlayNamed("SUCCESS");
  } else if (action == Action::BOUNCE) {
    faceSet("HAPPY"); restoreCalm = true;
  } else if (action == Action::WIGGLE) {
    faceSet("STAR"); restoreCalm = true;
  } else if (action == Action::LEFT || action == Action::RIGHT) {
    faceSet("WINK"); restoreCalm = true;
  } else {
    sfx::sfxPlayNamed("CLICK");
  }
  Serial.print(F("BUSY ")); Serial.println(actionName(action));
}

void startAction(Action action) {
  if (!OTTO_ENABLE_SERVOS) { replyError(F("SERVOS_DISABLED")); return; }
  if (quiet) { replyError(F("QUIET_MODE")); return; }
  if (voice != VoiceState::IDLE) { replyError(F("VOICE_ACTIVE")); return; }
  if (motionIsBusy()) {
    if (enqueueAction(action)) {
      Serial.print(F("QUEUED ")); Serial.println(actionName(action));
    } else {
      replyError(F("QUEUE_FULL"));
    }
    return;
  }
  if (action != Action::HOME && !motionIsArmed()) {
    replyError(F("SEND_HOME_FIRST")); return;
  }
  beginAction(action);
}
}

bool behaviorBegin() {
  configValid = validatePins();
  if (!configValid) return false; // 一处无效则不初始化任何外设。
  motionConfigure(); sfx::sfxBegin(); faceBegin(); soundBegin(millis()); distanceBegin(millis());
  return true;
}
void behaviorUpdate(unsigned long now) {
  if (!configValid) return;
  sfx::sfxUpdate(now);
  const bool allowSound = soundEnabled && !quiet && voice == VoiceState::IDLE &&
                          !motionIsBusy() && now >= soundMuteUntil;
  if (soundUpdate(now, allowSound)) {
    ++soundBurst;
    soundBurstAt = now;
    if (events) { Serial.print(F("EVENT SOUND ")); Serial.println(soundBurst); }
  }
  if (soundBurst && now - soundBurstAt >= 650) {
    const uint8_t count = soundBurst;
    soundBurst = 0;
    triggerSoundAction(count);
  }
  distanceUpdate(now);
  if (motionUpdate(now)) {
    soundMuteUntil = now + 700;
    Serial.print(F("OK ")); Serial.println(actionName(active)); active = Action::NONE;
    if (restoreCalm) faceSet("CALM");
    restoreCalm = false;
    Action next;
    if (dequeueAction(next)) beginAction(next);
  }
  if (events && OTTO_ENABLE_ULTRASONIC && now - distanceReportAt >= 1000) {
    distanceReportAt = now; Serial.print(F("EVENT DISTANCE ")); printDistance(now);
  }
  faceUpdate(now);
}
void behaviorFrame(const uint8_t rows[8], const char* command) {
  if (!configValid) { replyError(F("CONFIG_INVALID")); return; }
  if (quiet) { replyError(F("QUIET_MODE")); return; }
  faceSetFrame(rows); restoreCalm = false; faceUpdate(millis()); replyOk(command);
}
void behaviorCommand(char* command) {
  if (!strcmp(command, "PING")) { Serial.println(F("PONG")); return; }
  if (!strcmp(command, "INFO")) { printInfo(); return; }
  if (!strcmp(command, "HELP")) {
    Serial.println(F("INFO PING HOME SWING WAVE TWIST STOMP BOW SHAKE SIT DANCE HAPPY GREET STOP REST"));
    Serial.println(F("FACE CALM/SMILE/HAPPY/ANGRY/SLEEP/SURPRISE/HEART/STAR/WINK/BLINK/TALKING/OFF"));
    Serial.println(F("MATRIX SCAN/WAVE/SPIN/HEARTBEAT/STOP; SFX BOOT/HAPPY/SAD/ALERT/CLICK/SUCCESS/ERROR; BUZZTEST"));
    Serial.println(F("MODE NORMAL/QUIET; VOICE IDLE/LISTENING/THINKING/SPEAKING"));
    Serial.println(F("SENSORS; SOUND ON/OFF; EVENTS ON/OFF")); return;
  }
  if (!configValid) { replyError(F("CONFIG_INVALID")); return; }
  if (!strcmp(command, "STOP") || !strcmp(command, "REST")) {
    cancelMotion(!strcmp(command, "REST")); replyOk(command);
  } else if (!strcmp(command, "MODE QUIET")) {
    cancelMotion(false); quiet = true; faceSetQuiet(true); faceUpdate(millis()); replyOk(command);
  } else if (!strcmp(command, "MODE NORMAL")) {
    quiet = false; faceSetQuiet(false); faceUpdate(millis()); replyOk(command);
  } else if (!strncmp(command, "VOICE ", 6)) {
    VoiceState next;
    if (!strcmp(command + 6, "IDLE")) next = VoiceState::IDLE;
    else if (!strcmp(command + 6, "LISTENING")) next = VoiceState::LISTENING;
    else if (!strcmp(command + 6, "THINKING")) next = VoiceState::THINKING;
    else if (!strcmp(command + 6, "SPEAKING")) next = VoiceState::SPEAKING;
    else { replyError(F("VOICE_FORMAT")); return; }
    if (next != VoiceState::IDLE && motionIsBusy()) cancelMotion(false);
    voice = next; faceSetVoice(voice); faceUpdate(millis()); replyOk(command);
  } else if (!strncmp(command, "FACE ", 5)) {
    if (quiet) { replyError(F("QUIET_MODE")); return; }
    if (!faceSet(command + 5)) { replyError(F("FACE_NAME")); return; }
    restoreCalm = false; faceUpdate(millis()); replyOk(command);
  } else if (!strcmp(command, "HOME")) startAction(Action::HOME);
  else if (!strcmp(command, "SWING")) startAction(Action::SWING);
  else if (!strcmp(command, "WAVE")) startAction(Action::WAVE);
  else if (!strcmp(command, "TWIST")) startAction(Action::TWIST);
  else if (!strcmp(command, "STOMP")) startAction(Action::STOMP);
  else if (!strcmp(command, "BOW")) startAction(Action::BOW);
  else if (!strcmp(command, "SHAKE")) startAction(Action::SHAKE);
  else if (!strcmp(command, "SIT")) startAction(Action::SIT);
  else if (!strcmp(command, "DANCE")) startAction(Action::DANCE);
  else if (!strcmp(command, "WALK")) startAction(Action::WALK);
  else if (!strcmp(command, "BACK")) startAction(Action::BACK);
  else if (!strcmp(command, "LEFT")) startAction(Action::LEFT);
  else if (!strcmp(command, "RIGHT")) startAction(Action::RIGHT);
  else if (!strcmp(command, "BOUNCE")) startAction(Action::BOUNCE);
  else if (!strcmp(command, "WIGGLE")) startAction(Action::WIGGLE);
  else if (!strcmp(command, "HAPPY")) startAction(Action::HAPPY);
  else if (!strcmp(command, "GREET")) startAction(Action::GREET);
  else if (!strcmp(command, "F") || !strcmp(command, "B") ||
           !strcmp(command, "L") || !strcmp(command, "R")) replyError(F("WALK_UNAVAILABLE"));
  else if (!strcmp(command, "SENSORS")) {
    Serial.print(F("VALUE SOUND "));
    if (OTTO_ENABLE_SOUND) Serial.println(soundLatest()); else Serial.println(F("DISABLED"));
    Serial.print(F("VALUE DISTANCE ")); printDistance(millis()); Serial.println(F("SENSORS_END"));
  } else if (!strcmp(command, "SOUND ON") || !strcmp(command, "SOUND OFF")) {
    if (!OTTO_ENABLE_SOUND) { replyError(F("SOUND_DISABLED")); return; }
    soundEnabled = !strcmp(command, "SOUND ON"); replyOk(command);
  } else if (!strcmp(command, "EVENTS ON") || !strcmp(command, "EVENTS OFF")) {
    events = !strcmp(command, "EVENTS ON"); replyOk(command);
  } else if (!strcmp(command, "MATRIX TEST")) {
    matrix::matrixSelfTest(); replyOk(command);
  } else if (!strncmp(command, "MATRIX ", 7)) {
    if (!face::faceAnim(command + 7)) { replyError(F("MATRIX_NAME")); return; }
    replyOk(command);
  } else if (!strncmp(command, "SFX ", 4)) {
    if (!sfx::sfxPlayNamed(command + 4)) { replyError(F("SFX_NAME")); return; }
    replyOk(command);
  } else if (!strcmp(command, "BUZZTEST")) {
#if OTTO_ENABLE_BUZZER
    const uint8_t pins[] = {13, 9, 8, 12, 11, 10};
    for (uint8_t i = 0; i < 6; ++i) {
      Serial.print(F("BUZZ ")); Serial.println(pins[i]);
      tone(pins[i], 1500, 120);
      delay(400);
      noTone(pins[i]);
    }
    replyOk(command);
#else
    replyError(F("BUZZER_DISABLED"));
#endif
  } else if (!strncmp(command, "SIMSOUND ", 9)) {
    const uint8_t n = static_cast<uint8_t>(atoi(command + 9));
    if (n < 1 || n > 9) { replyError(F("SIM_FORMAT")); return; }
    triggerSoundAction(n); replyOk(command);
  } else if (!strncmp(command, "SENS ", 5)) {
    const uint16_t n = static_cast<uint16_t>(atoi(command + 5));
    if (n < 50 || n > 600) { replyError(F("SENS_FORMAT")); return; }
    sound::soundSetSensitivity(n); replyOk(command);
  } else if (!strncmp(command, "SERVO ", 6)) {
    uint8_t index = 0;
    uint16_t angle = 90;
    if (sscanf(command + 6, "%hhu %hu", &index, &angle) != 2 || index > 3 || angle > 180) {
      replyError(F("SERVO_FORMAT")); return;
    }
    motion::motionServo(index, static_cast<uint8_t>(angle));
    replyOk(command);
  } else if (!strcmp(command, "SERVOTEST")) {
    for (uint8_t i = 0; i < 4; ++i) {
      Serial.print(F("SERVO ")); Serial.println(i);
      motion::motionServo(i, 70); delay(500);
      motion::motionServo(i, 110); delay(500);
      motion::motionServo(i, 90); delay(400);
    }
    replyOk(command);
  } else replyError(F("UNKNOWN_COMMAND"));
}
}

// Module: router
namespace router {
using control::controlLinkBegin;
using control::controlLinkPoll;
using control::replyError;
using control::replyOk;
using behavior::behaviorBegin;
using behavior::behaviorUpdate;
using behavior::behaviorCommand;
using behavior::behaviorFrame;
namespace {
int8_t hexDigit(char c) {
  if (c >= '0' && c <= '9') return c - '0';
  if (c >= 'A' && c <= 'F') return c - 'A' + 10;
  return -1;
}
}
void routeCommand(char* command) {
  if (!strncmp(command, "FRAME ", 6)) {
    if (strlen(command) != 22) { replyError(F("FRAME_FORMAT")); return; }
    uint8_t rows[8];
    for (uint8_t i = 0; i < 8; ++i) {
      const int8_t high = hexDigit(command[6 + i * 2]);
      const int8_t low = hexDigit(command[7 + i * 2]);
      if (high < 0 || low < 0) { replyError(F("FRAME_FORMAT")); return; }
      rows[i] = high * 16 + low;
    }
    behaviorFrame(rows, command);
  } else behaviorCommand(command);
}
}


void setup() {
  control::controlLinkBegin();
  const bool ready = behavior::behaviorBegin();
  Serial.println(F("READY otto_controller v1"));
  if (ready) sfx::sfxPlayNamed("BOOT");
  if (!ready) control::replyError(F("CONFIG_INVALID"));
}
void loop() {
  control::controlLinkPoll();
  behavior::behaviorUpdate(millis());
}

