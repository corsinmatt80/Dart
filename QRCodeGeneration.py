import qrcode
from PIL import Image

# Die Daten, die im QR-Code enthalten sein sollen
data = "Hello, this is a QR code example!"

# QR-Code-Objekt erstellen
qr = qrcode.QRCode(
    version=1,  # Größe des QR-Codes (1 ist die kleinste Version)
    error_correction=qrcode.constants.ERROR_CORRECT_L,  # Fehlertoleranz
    box_size=10,  # Größe jedes Kastens
    border=4,  # Breite des Rahmens
)

# Daten zum QR-Code hinzufügen
qr.add_data(data)
qr.make(fit=True)

# QR-Code-Bild generieren
img = qr.make_image(fill='black', back_color='white')

# QR-Code-Bild anzeigen
img.show()

# Optional: QR-Code-Bild speichern
# img.save("qrcode_example.png")
