import type { FC } from 'react';
import { AuthPage } from './ui/auth-page';
import { NeonMesh } from './ui/neon-mesh';
import { AuthStatusResponse } from '../types';

interface Props {
    authStatus: AuthStatusResponse | null;
    onLogin: (email: string, password?: string, token?: string, cloudUrl?: string) => Promise<any>;
    onActivateKey: (key: string) => Promise<any>;
}

export const AuthGateScreen: FC<Props> = ({
    authStatus,
    onLogin,
    onActivateKey
}) => {
    return (
        <NeonMesh className="w-full min-h-screen flex items-center justify-center font-sans p-4">
            <div className="relative z-10 w-full max-w-md">
                <AuthPage
                    authStatus={authStatus}
                    onLogin={onLogin}
                    onActivateKey={onActivateKey}
                    isModal={false}
                />
            </div>
        </NeonMesh>
    );
};
