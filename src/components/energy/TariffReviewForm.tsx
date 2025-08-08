import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Settings, Zap } from 'lucide-react';
import { TariffRates } from '@/services/billPdf';
import { formatCurrency } from '@/utils/dateUtils';

interface TariffReviewFormProps {
  initialTariff?: TariffRates;
  onTariffConfirmed: (tariff: TariffRates) => void;
  onCancel?: () => void;
}

export function TariffReviewForm({ initialTariff, onTariffConfirmed, onCancel }: TariffReviewFormProps) {
  const [tariff, setTariff] = useState<TariffRates>(
    initialTariff || {
      supplier: 'ESB',
      plan: 'Smart Drive',
      meterType: 'SMART_TOU',
      standingChargeDaily: 0.285,
      vatRate: 0.135,
      rates: {
        peak: 0.42,
        day: 0.21,
        night: 0.12
      },
      confidence: 1.0
    }
  );

  const handleRateChange = (band: string, value: string) => {
    const numValue = parseFloat(value);
    if (!isNaN(numValue)) {
      setTariff(prev => ({
        ...prev,
        rates: {
          ...prev.rates,
          [band]: numValue
        }
      }));
    }
  };

  const handleMeterTypeChange = (meterType: '24HR' | 'DAY_NIGHT' | 'SMART_TOU') => {
    let defaultRates = {};
    
    switch (meterType) {
      case '24HR':
        defaultRates = { standard: 0.25 };
        break;
      case 'DAY_NIGHT':
        defaultRates = { day: 0.22, night: 0.14 };
        break;
      case 'SMART_TOU':
        defaultRates = { peak: 0.42, day: 0.21, night: 0.12 };
        break;
    }

    setTariff(prev => ({
      ...prev,
      meterType,
      rates: defaultRates
    }));
  };

  const addCustomBand = () => {
    const bandName = prompt('Enter band name (e.g., "weekend"):');
    if (bandName && !tariff.rates[bandName]) {
      setTariff(prev => ({
        ...prev,
        rates: {
          ...prev.rates,
          [bandName]: 0.20
        }
      }));
    }
  };

  const removeBand = (band: string) => {
    const { [band]: removed, ...remainingRates } = tariff.rates;
    setTariff(prev => ({
      ...prev,
      rates: remainingRates
    }));
  };

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Settings className="w-5 h-5 text-accent" />
          Review & Confirm Tariff Details
        </CardTitle>
        <CardDescription>
          {initialTariff 
            ? 'Please review the extracted tariff information and make any necessary adjustments.'
            : 'Enter your electricity tariff details manually.'
          }
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Basic Info */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="supplier">Supplier</Label>
            <Input
              id="supplier"
              value={tariff.supplier}
              onChange={(e) => setTariff(prev => ({ ...prev, supplier: e.target.value }))}
              placeholder="ESB, Electric Ireland, etc."
            />
          </div>
          
          <div className="space-y-2">
            <Label htmlFor="plan">Plan Name</Label>
            <Input
              id="plan"
              value={tariff.plan}
              onChange={(e) => setTariff(prev => ({ ...prev, plan: e.target.value }))}
              placeholder="Smart Drive, Standard, etc."
            />
          </div>
        </div>

        {/* Meter Type */}
        <div className="space-y-2">
          <Label>Meter Type</Label>
          <Select 
            value={tariff.meterType} 
            onValueChange={handleMeterTypeChange}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="24HR">24 Hour (Single Rate)</SelectItem>
              <SelectItem value="DAY_NIGHT">Day/Night (Dual Rate)</SelectItem>
              <SelectItem value="SMART_TOU">Smart Time of Use</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Standing Charge & VAT */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="standing">Standing Charge (€/day)</Label>
            <Input
              id="standing"
              type="number"
              step="0.001"
              value={tariff.standingChargeDaily}
              onChange={(e) => setTariff(prev => ({ 
                ...prev, 
                standingChargeDaily: parseFloat(e.target.value) || 0 
              }))}
            />
          </div>
          
          <div className="space-y-2">
            <Label htmlFor="vat">VAT Rate (%)</Label>
            <Input
              id="vat"
              type="number"
              step="0.1"
              value={tariff.vatRate * 100}
              onChange={(e) => setTariff(prev => ({ 
                ...prev, 
                vatRate: (parseFloat(e.target.value) || 0) / 100 
              }))}
            />
          </div>
        </div>

        {/* Electricity Rates */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <Label className="text-base font-medium">Electricity Rates (€/kWh)</Label>
            <Button variant="outline" size="sm" onClick={addCustomBand}>
              Add Band
            </Button>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {Object.entries(tariff.rates).map(([band, rate]) => (
              <div key={band} className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor={`rate-${band}`} className="capitalize">
                    {band} Rate
                  </Label>
                  {Object.keys(tariff.rates).length > 1 && (
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      onClick={() => removeBand(band)}
                      className="text-destructive hover:text-destructive"
                    >
                      Remove
                    </Button>
                  )}
                </div>
                <Input
                  id={`rate-${band}`}
                  type="number"
                  step="0.001"
                  value={rate}
                  onChange={(e) => handleRateChange(band, e.target.value)}
                />
              </div>
            ))}
          </div>
        </div>

        {/* Preview */}
        <div className="space-y-3 p-4 bg-secondary/50 rounded-lg">
          <h4 className="font-medium flex items-center gap-2">
            <Zap className="w-4 h-4" />
            Tariff Summary
          </h4>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-muted-foreground">Supplier:</span>
              <Badge variant="secondary" className="ml-2">{tariff.supplier}</Badge>
            </div>
            <div>
              <span className="text-muted-foreground">Meter:</span>
              <Badge variant="secondary" className="ml-2">{tariff.meterType}</Badge>
            </div>
            <div>
              <span className="text-muted-foreground">Standing Charge:</span>
              <span className="ml-2 font-medium">{formatCurrency(tariff.standingChargeDaily)}/day</span>
            </div>
            <div>
              <span className="text-muted-foreground">VAT:</span>
              <span className="ml-2 font-medium">{(tariff.vatRate * 100).toFixed(1)}%</span>
            </div>
          </div>
          <div>
            <span className="text-muted-foreground">Rates:</span>
            <div className="flex flex-wrap gap-2 mt-1">
              {Object.entries(tariff.rates).map(([band, rate]) => (
                <Badge key={band} variant="outline">
                  {band}: {formatCurrency(rate)}/kWh
                </Badge>
              ))}
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex justify-between">
          {onCancel && (
            <Button variant="outline" onClick={onCancel}>
              Cancel
            </Button>
          )}
          <Button 
            onClick={() => onTariffConfirmed({ ...tariff, confidence: 1.0 })}
            className="ml-auto"
          >
            Confirm Tariff
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}