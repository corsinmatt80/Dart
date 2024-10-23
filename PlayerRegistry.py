import cv2
import numpy as np
from pyzbar.pyzbar import decode
from tkinter import Tk, Label, Entry, Button

# QR-Code scannen mit OpenCV
def scan_qr_code():
    cap = cv2.VideoCapture(0)
    
    while True:
        ret, frame = cap.read()
        if not ret:
            break
        
        for barcode in decode(frame):
            qr_data = barcode.data.decode('utf-8')
            cap.release()
            cv2.destroyAllWindows()
            return qr_data
            
        cv2.imshow('QR Code Scanner', frame)
        
        if cv2.waitKey(1) & 0xFF == ord('q'):
            break
            
    cap.release()
    cv2.destroyAllWindows()

# Foto aufnehmen mit OpenCV
def take_picture(player_id):
    cap = cv2.VideoCapture(0)
    ret, frame = cap.read()
    if ret:
        cv2.imshow("Press 's' to save", frame)
        if cv2.waitKey(0) & 0xFF == ord('s'):
            cv2.imwrite(f"{player_id}_photo.png", frame)
    cap.release()
    cv2.destroyAllWindows()

# Registrierung GUI mit tkinter
def registration_window(player_id):
    def submit():
        name = name_entry.get()
        take_picture(player_id)
        print(f"Player {player_id}: Name: {name} registered")
        root.destroy()
    
    root = Tk()
    root.title("Player Registration")
    
    Label(root, text=f"Player ID: {player_id}").pack()
    Label(root, text="Enter your name:").pack()
    
    name_entry = Entry(root)
    name_entry.pack()
    
    Button(root, text="Submit", command=submit).pack()
    
    root.mainloop()

# Hauptlogik für QR-Code-Scanning und Registrierung
def main():
    print("Scanning QR code...")
    player_id = scan_qr_code()
    
    if player_id:
        print(f"QR Code for Player {player_id} scanned successfully!")
        registration_window(player_id)
    else:
        print("QR Code scanning failed!")

if __name__ == "__main__":
    main()
