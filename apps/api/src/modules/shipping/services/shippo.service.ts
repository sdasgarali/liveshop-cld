import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

interface Address {
  name: string;
  street1: string;
  street2?: string;
  city: string;
  state: string;
  zip: string;
  country: string;
  phone?: string;
  email?: string;
}

interface Parcel {
  length: number;
  width: number;
  height: number;
  weight: number;
  distanceUnit?: 'in' | 'cm';
  massUnit?: 'oz' | 'lb' | 'g' | 'kg';
}

interface ShippingRate {
  carrier: string;
  service: string;
  amount: number;
  currency: string;
  estimatedDays: number;
  rateId: string;
}

interface ShippingLabel {
  labelUrl: string;
  trackingNumber: string;
  carrier: string;
  service: string;
  cost: number;
}

@Injectable()
export class ShippoService {
  private readonly apiKey: string;
  private readonly apiUrl = 'https://api.goshippo.com';

  constructor(private readonly configService: ConfigService) {
    this.apiKey = this.configService.get<string>('SHIPPO_API_KEY') || '';
  }

  async getRates(
    fromAddress: Address,
    toAddress: Address,
    parcel: Parcel,
  ): Promise<ShippingRate[]> {
    if (!this.apiKey) {
      // Return mock rates if API key not configured
      return this.getMockRates();
    }

    try {
      // Create shipment
      const shipmentResponse = await fetch(`${this.apiUrl}/shipments`, {
        method: 'POST',
        headers: {
          'Authorization': `ShippoToken ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          address_from: this.formatAddress(fromAddress),
          address_to: this.formatAddress(toAddress),
          parcels: [this.formatParcel(parcel)],
          async: false,
        }),
      });

      if (!shipmentResponse.ok) {
        throw new Error('Failed to create shipment');
      }

      const shipment = await shipmentResponse.json();

      // Extract rates
      const rates: ShippingRate[] = shipment.rates.map((rate: any) => ({
        carrier: rate.provider,
        service: rate.servicelevel.name,
        amount: parseFloat(rate.amount),
        currency: rate.currency,
        estimatedDays: rate.estimated_days || 5,
        rateId: rate.object_id,
      }));

      return rates.sort((a, b) => a.amount - b.amount);
    } catch (error) {
      console.error('Shippo getRates error:', error);
      return this.getMockRates();
    }
  }

  async purchaseLabel(rateId: string): Promise<ShippingLabel> {
    if (!this.apiKey) {
      return this.getMockLabel();
    }

    try {
      const response = await fetch(`${this.apiUrl}/transactions`, {
        method: 'POST',
        headers: {
          'Authorization': `ShippoToken ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          rate: rateId,
          label_file_type: 'PDF',
          async: false,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to purchase label');
      }

      const transaction = await response.json();

      if (transaction.status !== 'SUCCESS') {
        throw new Error(transaction.messages?.[0]?.text || 'Label purchase failed');
      }

      return {
        labelUrl: transaction.label_url,
        trackingNumber: transaction.tracking_number,
        carrier: transaction.rate.provider,
        service: transaction.rate.servicelevel.name,
        cost: parseFloat(transaction.rate.amount),
      };
    } catch (error) {
      console.error('Shippo purchaseLabel error:', error);
      throw new InternalServerErrorException('Failed to purchase shipping label');
    }
  }

  async getTrackingInfo(carrier: string, trackingNumber: string) {
    if (!this.apiKey) {
      return this.getMockTrackingInfo(trackingNumber);
    }

    try {
      const response = await fetch(
        `${this.apiUrl}/tracks/${carrier}/${trackingNumber}`,
        {
          headers: {
            'Authorization': `ShippoToken ${this.apiKey}`,
          },
        },
      );

      if (!response.ok) {
        throw new Error('Failed to get tracking info');
      }

      const tracking = await response.json();

      return {
        carrier: tracking.carrier,
        trackingNumber: tracking.tracking_number,
        status: tracking.tracking_status?.status || 'UNKNOWN',
        statusDetails: tracking.tracking_status?.status_details,
        estimatedDelivery: tracking.eta,
        history: tracking.tracking_history?.map((event: any) => ({
          status: event.status,
          details: event.status_details,
          location: event.location?.city
            ? `${event.location.city}, ${event.location.state}`
            : null,
          timestamp: event.status_date,
        })) || [],
      };
    } catch (error) {
      console.error('Shippo getTrackingInfo error:', error);
      return this.getMockTrackingInfo(trackingNumber);
    }
  }

  async validateAddress(address: Address): Promise<{ valid: boolean; suggestions?: Address[] }> {
    if (!this.apiKey) {
      return { valid: true };
    }

    try {
      const response = await fetch(`${this.apiUrl}/addresses`, {
        method: 'POST',
        headers: {
          'Authorization': `ShippoToken ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ...this.formatAddress(address),
          validate: true,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to validate address');
      }

      const result = await response.json();

      return {
        valid: result.validation_results?.is_valid || false,
        suggestions: result.validation_results?.messages?.map((msg: any) => msg.text) || [],
      };
    } catch (error) {
      console.error('Shippo validateAddress error:', error);
      return { valid: true };
    }
  }

  private formatAddress(address: Address) {
    return {
      name: address.name,
      street1: address.street1,
      street2: address.street2 || '',
      city: address.city,
      state: address.state,
      zip: address.zip,
      country: address.country,
      phone: address.phone || '',
      email: address.email || '',
    };
  }

  private formatParcel(parcel: Parcel) {
    return {
      length: parcel.length.toString(),
      width: parcel.width.toString(),
      height: parcel.height.toString(),
      weight: parcel.weight.toString(),
      distance_unit: parcel.distanceUnit || 'in',
      mass_unit: parcel.massUnit || 'oz',
    };
  }

  private getMockRates(): ShippingRate[] {
    return [
      {
        carrier: 'USPS',
        service: 'Priority Mail',
        amount: 8.99,
        currency: 'USD',
        estimatedDays: 3,
        rateId: 'mock-rate-1',
      },
      {
        carrier: 'USPS',
        service: 'First Class',
        amount: 4.99,
        currency: 'USD',
        estimatedDays: 5,
        rateId: 'mock-rate-2',
      },
      {
        carrier: 'UPS',
        service: 'Ground',
        amount: 9.99,
        currency: 'USD',
        estimatedDays: 5,
        rateId: 'mock-rate-3',
      },
      {
        carrier: 'FedEx',
        service: 'Home Delivery',
        amount: 11.99,
        currency: 'USD',
        estimatedDays: 4,
        rateId: 'mock-rate-4',
      },
    ];
  }

  private getMockLabel(): ShippingLabel {
    return {
      labelUrl: 'https://example.com/mock-label.pdf',
      trackingNumber: `MOCK${Date.now()}`,
      carrier: 'USPS',
      service: 'Priority Mail',
      cost: 8.99,
    };
  }

  private getMockTrackingInfo(trackingNumber: string) {
    return {
      carrier: 'USPS',
      trackingNumber,
      status: 'IN_TRANSIT',
      statusDetails: 'Package is in transit',
      estimatedDelivery: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
      history: [
        {
          status: 'TRANSIT',
          details: 'In transit to destination',
          location: 'Los Angeles, CA',
          timestamp: new Date().toISOString(),
        },
        {
          status: 'TRANSIT',
          details: 'Departed facility',
          location: 'San Francisco, CA',
          timestamp: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
        },
        {
          status: 'PRE_TRANSIT',
          details: 'Shipping label created',
          location: 'San Francisco, CA',
          timestamp: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(),
        },
      ],
    };
  }
}
