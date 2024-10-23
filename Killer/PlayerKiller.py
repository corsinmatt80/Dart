
class Player:
    def __init__(self,name: str,number : int):
        self.name = name
        self.number = number
        self.is_killer = False
        self.level = 0
    
    def loose_level(self):
        self.level -= 1
        return self.level