from django.core.management import BaseCommand
from journal.models import StrategyTag

NAMES = ["Breakout","Pullback","Reversal","VWAP","Trend","News"]

class Command(BaseCommand):
    help = "Seed default strategy tags"
    def handle(self, *args, **opts):
        for n in NAMES:
            StrategyTag.objects.get_or_create(name=n)
        self.stdout.write(self.style.SUCCESS("Seeded strategy tags"))
        
