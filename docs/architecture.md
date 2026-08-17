# Kien truc toi gian

Project giu mot luong du lieu duy nhat:

```text
ESP32 <-> HiveMQ Public <-> Node-RED <-> Website
                              |
                              +-> local JSON / Firebase (neu cau hinh)
```

## Thanh phan

- `firmware/`: doc cam bien, canh bao do duc tai cho, publish MQTT va nhan lenh relay.
- `nodered/`: nhan MQTT, cap nhat dashboard, xu ly API va cac dich vu tuy chon.
- `website/`: giao dien nguoi dung; khong ket noi truc tiep den MQTT va khong giu secret.

## MQTT contract

Device ID dung cho ban demo la `hcmus-aqua-18`.

| Topic | Payload |
|---|---|
| `aquaiot/hcmus-aqua-18/telemetry` | JSON cam bien, relay va RSSI |
| `aquaiot/hcmus-aqua-18/status` | `online` hoac `offline` |
| `aquaiot/hcmus-aqua-18/command` | JSON lenh `ON`, `OFF` hoac `MODE` |

Telemetry chi giu cac truong dang duoc website su dung. Trang thai relay tren web duoc cap nhat tu telemetry cua ESP32, khong tu suy dien sau khi bam nut.

Broker mac dinh la `broker.hivemq.com:1883`. Day la broker public cho demo, vi vay khong publish mat khau, token hay du lieu nhay cam.
