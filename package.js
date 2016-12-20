Package.describe({
  name: 'pornel:slip',
  summary: 'UI library for manipulating lists via swipe and drag gestures.',
  version: '2.0.0',
  git: 'https://github.com/pornel/slip.git',
  documentation: 'README.md'
});

Package.onUse(function (api) {
  api.versionsFrom('METEOR@1.0');
  api.use('jquery', 'client');
  
  api.addFiles('slip.js', 'client');
});