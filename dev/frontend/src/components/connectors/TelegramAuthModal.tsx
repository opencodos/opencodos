import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { integrationAPI } from '@/lib/api';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface TelegramAuthModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

type AuthStatus = 'initiating' | 'scanning' | 'requires_2fa' | 'completing' | 'error';

interface AuthState {
  status: AuthStatus;
  authRequestId?: string;
  qrUrl?: string;
  error?: string;
  username?: string;
  telegramUserId?: number;
}

export function TelegramAuthModal({ open, onOpenChange, onSuccess }: TelegramAuthModalProps) {
  const [authState, setAuthState] = useState<AuthState>({ status: 'initiating' });
  const [password, setPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');

  // Initiate auth when modal opens
  useEffect(() => {
    if (open) {
      initiateAuth();
    } else {
      // Reset state when modal closes
      setAuthState({ status: 'initiating' });
      setPassword('');
      setPasswordError('');
    }
  }, [open]);

  // Polling logic for QR scan
  useEffect(() => {
    if (authState.status === 'scanning' && authState.authRequestId) {
      const interval = setInterval(() => {
        pollAuthStatus(authState.authRequestId!);
      }, 2000); // Poll every 2 seconds

      return () => clearInterval(interval);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authState.status, authState.authRequestId]);

  const initiateAuth = async () => {
    try {
      setAuthState({ status: 'initiating' });

      const result = await integrationAPI.initiateTelegramAuth();
      console.log('/telegram/auth/initiate response', result);
      console.log('setting state to scanning...');

      setAuthState({
        status: 'scanning',
        authRequestId: result.auth_request_id,
        qrUrl: result.qr_url,
      });
    } catch (error) {
      console.error('Error initiating Telegram auth:', error);
      setAuthState({
        status: 'error',
        error: error instanceof Error ? error.message : 'Failed to initiate authentication',
      });
    }
  };

  const pollAuthStatus = async (authRequestId: string) => {
    try {
      const result = await integrationAPI.pollTelegramAuth(authRequestId);
      console.log('/telegram/auth/poll response', result);

      if (result.status === 'completed') {
        // Auth successful, complete the flow
        setAuthState((prev) => ({
          ...prev,
          status: 'completing',
          username: result.username,
          telegramUserId: result.telegram_user_id,
        }));
        await completeAuth(authRequestId);
      } else if (result.status === 'requires_2fa') {
        // 2FA required
        setAuthState((prev) => ({
          ...prev,
          status: 'requires_2fa',
        }));
      } else if (result.status === 'expired') {
        // Session expired, restart
        setAuthState({
          status: 'error',
          error: 'QR code expired. Please try again.',
        });
      }
      // If status is 'pending', continue polling
    } catch (error) {
      console.error('Error polling auth status:', error);
      // Don't show error for network issues during polling
      // Just continue polling
    }
  };

  const handle2FA = async () => {
    if (!password.trim()) {
      setPasswordError('Password is required');
      return;
    }

    if (!authState.authRequestId) {
      setPasswordError('Invalid auth session');
      return;
    }

    try {
      setPasswordError('');
      const result = await integrationAPI.submitTelegram2FA(authState.authRequestId, password);

      if (result.status === 'completed') {
        // 2FA successful
        setAuthState((prev) => ({
          ...prev,
          status: 'completing',
          username: result.username,
          telegramUserId: result.telegram_user_id,
        }));
        await completeAuth(authState.authRequestId);
      } else {
        // Invalid password
        setPasswordError(result.error || 'Invalid password. Please try again.');
      }
    } catch (error) {
      console.error('Error submitting 2FA:', error);
      setPasswordError(error instanceof Error ? error.message : 'Failed to submit password');
    }
  };

  const completeAuth = async (authRequestId: string) => {
    try {
      console.log('completing auth!');
      await integrationAPI.completeTelegramAuth(authRequestId);

      // Success! Close modal and notify parent
      onSuccess();
    } catch (error) {
      console.error('Error completing auth:', error);
      setAuthState({
        status: 'error',
        error: error instanceof Error ? error.message : 'Failed to complete authentication',
      });
    }
  };

  const handleRetry = () => {
    initiateAuth();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Connect Telegram</DialogTitle>
          <DialogDescription>
            {authState.status === 'scanning' && 'Scan this QR code with your Telegram app'}
            {authState.status === 'requires_2fa' && 'Enter your Telegram 2FA password'}
            {authState.status === 'initiating' && 'Generating QR code...'}
            {authState.status === 'completing' && 'Completing authentication...'}
            {authState.status === 'error' && 'Authentication failed'}
          </DialogDescription>
        </DialogHeader>

        {/* QR Code Display */}
        {authState.status === 'scanning' && authState.qrUrl && (
          <div className="flex flex-col items-center gap-4 p-6">
            <img
              src={authState.qrUrl}
              alt="Telegram QR Code"
              className="w-64 h-64 border rounded"
              onError={() => {
                setAuthState({
                  status: 'error',
                  error: 'Failed to load QR code. Please try again.',
                });
              }}
            />
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Waiting for scan...
            </div>
            <p className="text-xs text-center text-muted-foreground max-w-sm">
              Open Telegram on your phone → Settings → Devices → Link Desktop Device → Scan this QR
              code
            </p>
          </div>
        )}

        {/* 2FA Password Input */}
        {authState.status === 'requires_2fa' && (
          <div className="flex flex-col gap-4 p-6">
            <div className="space-y-2">
              <Input
                type="password"
                placeholder="Enter 2FA password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setPasswordError('');
                }}
                onKeyPress={(e) => {
                  if (e.key === 'Enter') {
                    handle2FA();
                  }
                }}
                className={passwordError ? 'border-destructive' : ''}
              />
              {passwordError && <p className="text-sm text-destructive">{passwordError}</p>}
            </div>
            <Button onClick={handle2FA} className="w-full">
              Submit
            </Button>
          </div>
        )}

        {/* Loading State */}
        {(authState.status === 'initiating' || authState.status === 'completing') && (
          <div className="flex flex-col items-center justify-center p-12 gap-4">
            <Loader2 className="h-8 w-8 animate-spin" />
            <p className="text-sm text-muted-foreground">
              {authState.status === 'initiating' ? 'Generating QR code...' : 'Completing setup...'}
            </p>
          </div>
        )}

        {/* Error State */}
        {authState.status === 'error' && (
          <div className="flex flex-col items-center p-6 gap-4">
            <div className="text-center">
              <p className="text-destructive font-medium mb-2">Authentication Failed</p>
              <p className="text-sm text-muted-foreground">{authState.error}</p>
            </div>
            <Button onClick={handleRetry} variant="outline" className="w-full">
              Try Again
            </Button>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
