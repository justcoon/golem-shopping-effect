import apiClient from "../config";
import type { Address } from "@/types/address";
import { DateTime } from "@/types/datetime.ts";

export interface CartItem {
  productId: string;
  productName: string;
  productBrand: string;
  price: number;
  quantity: number;
}

export interface CheckoutDraft {
  orderId: string;
  expiresAt: string;
  createdAt: string;
}

export interface Cart {
  userId: string;
  items: CartItem[];
  email?: string;
  billingAddress?: Address;
  shippingAddress?: Address;
  total: number;
  currency: string;
  previousOrderIds: string[];
  updatedAt: DateTime;
  draft?: CheckoutDraft;
}

export interface OrderConfirmation {
  orderId: string;
}

export const getCart = async (userId: string): Promise<Cart> => {
  try {
    const response = await apiClient.get(`/v1/cart/${userId}`);
    return response;
  } catch (error) {
    console.error(`Error fetching cart for user ${userId}:`, error);
    throw error;
  }
};

export const addToCart = async (
  userId: string,
  productId: string,
  quantity: number = 1,
): Promise<void> => {
  try {
    await apiClient.put(`/v1/cart/${userId}/items/${productId}`, { quantity });
  } catch (error) {
    console.error(`Error adding item ${productId} to cart:`, error);
    throw error;
  }
};

export const removeFromCart = async (userId: string, productId: string): Promise<void> => {
  try {
    await apiClient.delete(`/v1/cart/${userId}/items/${productId}`);
  } catch (error) {
    console.error(`Error removing item ${productId} from cart:`, error);
    throw error;
  }
};

export const updateCartEmail = async (userId: string, email: string): Promise<void> => {
  try {
    await apiClient.put(`/v1/cart/${userId}/email`, { email });
  } catch (error) {
    console.error(`Error updating cart email:`, error);
    throw error;
  }
};

export const updateBillingAddress = async (userId: string, address: Address): Promise<Cart> => {
  try {
    const response = await apiClient.put(`/v1/cart/${userId}/billing-address`, address);
    return response;
  } catch (error) {
    console.error(`Error updating billing address for user ${userId}:`, error);
    throw error;
  }
};

export const updateShippingAddress = async (userId: string, address: Address): Promise<Cart> => {
  try {
    const response = await apiClient.put(`/v1/cart/${userId}/shipping-address`, address);
    return response;
  } catch (error) {
    console.error(`Error updating shipping address for user ${userId}:`, error);
    throw error;
  }
};

export const prepareCheckout = async (userId: string): Promise<Cart> => {
  try {
    const response = await apiClient.post(`/v1/cart/${userId}/checkout/prepare`, {});
    return response;
  } catch (error) {
    console.error("Error during prepare checkout:", error);
    throw error;
  }
};

export const confirmCheckout = async (
  userId: string,
  orderId: string,
): Promise<OrderConfirmation> => {
  try {
    const response = await apiClient.post(`/v1/cart/${userId}/checkout/confirm`, {
      orderId,
    });
    return response;
  } catch (error) {
    console.error("Error during confirm checkout:", error);
    throw error;
  }
};

export const cancelCheckout = async (userId: string, orderId: string): Promise<void> => {
  try {
    await apiClient.post(`/v1/cart/${userId}/checkout/cancel`, {
      orderId,
    });
  } catch (error) {
    console.error("Error during cancel checkout:", error);
    throw error;
  }
};
