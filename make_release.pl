#!/usr/bin/perl

# This is a dummy, its purpose is to call a script with the same name in the buildtools repository

$0 =~ s/(.*[\\\/])//g;
chdir($1) if $1;

system("hg", "clone", "https://hg.adblockplus.org/buildtools/") unless -e "buildtools";

do "buildtools/$0";
die $@ if $@;
