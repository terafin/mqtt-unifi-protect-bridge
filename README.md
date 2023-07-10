# mqtt-unifi-protect-bridge

This is a simple docker container that I use to bridge UniFi protect with my MQTT bridge.

I have a collection of bridges, and the general format of these begins with these environment variables:

```
      TOPIC_PREFIX: /your_topic_prefix  (eg: /some_topic_prefix/somthing)
      MQTT_HOST: YOUR_MQTT_URL (eg: mqtt://mqtt.yourdomain.net)
      (OPTIONAL) MQTT_USER: YOUR_MQTT_USERNAME
      (OPTIONAL) MQTT_PASS: YOUR_MQTT_PASSWORD
      (OPTIONAL) MQTT_STATUS_TOPIC_PREFIX: '/status_prefix/'
```

This will publish and (optionally) subscribe to events for this bridge with the TOPIC_PREFIX of you choosing.

Generally I use 0 as 'off', and 1 as 'on' for these.

Here's an example docker compose:

```docker
version: '3.3'
services:
  mqtt-unifi-protect-bridge:
    image: ghcr.io/terafin/mqtt-unifi-protect-bridge:latest
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
      (OPTIONAL) MQTT_STATUS_TOPIC_PREFIX: '/status_prefix/' (note, it will use logging-name appended to this)
```

Here's an example publish for some of my cameras:

```log
/motion/kitchen_door 0
/motion/kitchen_door/state connected
/motion/driveway 0
/motion/driveway/state connected
/motion/front_door_driveway 0
/motion/front_door_driveway/state disconnected
/motion/rear_corner 0
/motion/rear_corner/state connected
```
