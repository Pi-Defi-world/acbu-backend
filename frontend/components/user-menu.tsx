'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { User, Settings, Shield, Eye, Building2, Clock, HelpCircle, LogOut } from 'lucide-react';
import { useAuth } from '@/contexts/auth-context';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';

interface MenuItem {
  title: string;
  icon: React.ElementType;
  href: string;
}

const menuItems: MenuItem[] = [
  { title: 'Profile', icon: User, href: '/me/profile' },
  { title: 'Settings', icon: Settings, href: '/me/settings' },
  { title: 'Two-Factor Auth', icon: Shield, href: '/me/settings/security' },
  { title: 'Wallet', icon: Eye, href: '/wallet' },
  { title: 'Simulated Bank', icon: Building2, href: '/fiat' },
];

const supportItems: MenuItem[] = [
  { title: 'Activity History', icon: Clock, href: '/activity' },
  { title: 'Help Center', icon: HelpCircle, href: '/help' },
];

interface UserMenuProps {
  displayName?: string;
}

export function UserMenu({ displayName }: UserMenuProps) {
  const router = useRouter();
  const { logout } = useAuth();
  const initials = (displayName?.slice(0, 2) || 'AB').toUpperCase();

  const handleLogout = async () => {
    await logout();
    router.replace('/auth/signin');
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="relative h-10 w-10 rounded-full">
          <Avatar className="h-10 w-10">
            <AvatarFallback className="bg-gradient-to-br from-primary to-secondary text-white">
              {initials}
            </AvatarFallback>
          </Avatar>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-56" align="end">
        <DropdownMenuLabel>
          <div className="flex flex-col space-y-1">
            <p className="text-sm font-medium leading-none">{displayName || 'Account'}</p>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {menuItems.map((item) => {
          const Icon = item.icon;
          return (
            <DropdownMenuItem key={item.href} asChild>
              <Link href={item.href} className="cursor-pointer">
                <Icon className="mr-2 h-4 w-4" />
                <span>{item.title}</span>
              </Link>
            </DropdownMenuItem>
          );
        })}
        <DropdownMenuSeparator />
        {supportItems.map((item) => {
          const Icon = item.icon;
          return (
            <DropdownMenuItem key={item.href} asChild>
              <Link href={item.href} className="cursor-pointer">
                <Icon className="mr-2 h-4 w-4" />
                <span>{item.title}</span>
              </Link>
            </DropdownMenuItem>
          );
        })}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="text-destructive focus:text-destructive cursor-pointer"
          onSelect={handleLogout}
        >
          <LogOut className="mr-2 h-4 w-4" />
          <span>Sign Out</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
