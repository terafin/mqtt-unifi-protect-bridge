# mqtt-unifi-protect-bridge

Example docker compose

```
version: '3.3'
services:
  mqtt-unifi-protect-bridge:
    image: terafin/mqtt-unifi-protect-bridge:latest
    environment:
      LOGGING_NAME: mqtt-unifi-protect-bridge
      PROTECT_URL: URL_FOR_UNIFI_PROTECT_LOGIN (eg: https://10.0.1.2:7443)
      USERNAME: YOUR_USERNAME_FOR_ABOVE_URL
      PASSWORD: YOUR_PASSWORD_FOR_ABOVE_URL
      POLL_FREQUENCY: 1
      TOPIC_PREFIX: /your_topic_prefix  (eg: /motion)
      MQTT_HOST: YOUR_MQTT_URL (eg: mqtt://mqtt.yourdomain.net)
      (OPTIONAL) MQTT_USER: YOUR_MQTT_USERNAME
      (OPTIONAL) MQTT_PASS: YOUR_MQTT_PASSWORD
```
