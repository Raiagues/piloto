#include <Arduino.h>

constexpr uint8_t TEMPERATURE_PIN = A0;
constexpr uint8_t BATTERY_PIN = A1;
constexpr unsigned long SAMPLE_INTERVAL_MS = 1000;
constexpr float ADC_REFERENCE_V = 5.0F;
constexpr float ADC_MAX = 1023.0F;
constexpr float DIVIDER_R1_OHM = 10000.0F;
constexpr float DIVIDER_R2_OHM = 10000.0F;

unsigned long lastSampleAt = 0;
uint32_t sequenceNumber = 0;

float analogVoltage(uint8_t pin) {
  return analogRead(pin) * (ADC_REFERENCE_V / ADC_MAX);
}
float readTemperatureC() {
  const float sensorVoltage = analogVoltage(TEMPERATURE_PIN);
  return (sensorVoltage - 0.5F) * 100.0F;
}

float readBatteryVoltage() {
  const float dividedVoltage = analogVoltage(BATTERY_PIN);
  return dividedVoltage * ((DIVIDER_R1_OHM + DIVIDER_R2_OHM) / DIVIDER_R2_OHM);
}

uint8_t frameChecksum(uint32_t sequence, unsigned long timestamp, int16_t temperatureCentiC, uint16_t batteryMilliV) {
  uint32_t value = sequence ^ timestamp;
  value ^= static_cast<uint16_t>(temperatureCentiC);
  value ^= batteryMilliV;
  value ^= value >> 16;
  value ^= value >> 8;
  return static_cast<uint8_t>(value & 0xFF);
}

void setup() {
  Serial.begin(115200);
  analogReference(DEFAULT);
  Serial.println(F("sequence,milliseconds,temperature_c,battery_v,checksum"));
}

void loop() {
  const unsigned long now = millis();
  if (now - lastSampleAt < SAMPLE_INTERVAL_MS) return;
  lastSampleAt = now;

  const float temperatureC = readTemperatureC();
  const float batteryV = readBatteryVoltage();
  const int16_t temperatureCentiC = static_cast<int16_t>(temperatureC * 100.0F);
  const uint16_t batteryMilliV = static_cast<uint16_t>(batteryV * 1000.0F);
  const uint8_t checksum = frameChecksum(sequenceNumber, now, temperatureCentiC, batteryMilliV);

  Serial.print(sequenceNumber++);
  Serial.print(',');
  Serial.print(now);
  Serial.print(',');
  Serial.print(temperatureC, 2);
  Serial.print(',');
  Serial.print(batteryV, 3);
  Serial.print(',');
  Serial.println(checksum, HEX);
}
