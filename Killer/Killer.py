from Exceptions.TooManyPlayersException import TooManyPlayersException

class Killer:
    def __init__(self, amount_players: int):
        self.amount_players = amount_players
        if self.amount_players > 4:
            raise TooManyPlayersException("Zu viele Spieler, maximal 4 erlaubt.")

    # Dies könnte ein Teil deiner KillerGame-Klasse sein
    def register_player_from_qr(token):
        if token in player_data:
            name = player_data[token]
            player = game.add_player(name)  # Spieler zum Spiel hinzufügen
            print(f"Spieler {name} wurde erfolgreich hinzugefügt.")
        else:
            print(f"Token {token} nicht gefunden.")
