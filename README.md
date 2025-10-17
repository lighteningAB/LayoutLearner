# Layout Learner

Layout learner is a web application designed to help teach anyone alternate keyboard layouts and shortcuts.

![alt text](https://github.com/LighteningAB/LayoutLearner/blob/main/app/public/layoutLearnerHomepage.png)

## Local Development

In order to run locally:

### clone the repository

```bash
git clone https://github.com/lighteningAB/LayoutLearner.git
```

### setup npm and yarn (skip if already done)

Linux

```bash
sudo apt install -y nodejs npm

sudo npm install -g yarn
```

Mac

```bash
brew install node

sudo npm install -g yarn
```

### navigate to repository root, download dependencies, build app for development

```bash
yarn install
yarn build
yarn dev
```

## Contribution Guide

Pull requests to make changes or contributions to this project are welcome. For major new features or large codebase changes please open an issue before.

## Build Status

![Vercel Deploy](https://deploy-badge.vercel.app/vercel/Layout-Learner)

## Roadmap

1. Add in handling of different layers to key press test

2. Handle rotation of keys for layouts

3. Create typing test using natural language and code snippets

4. Analytics of commonly missed keys and patterns in order to develop specific training to improve accuracy

5. Use of server to store information in order to allow for competition

6. Processing of uploaded pictures in order to automatically generate layout JSON from a photo of a keyboard

## Acknowledgements

Thank you to [ijprest](https://github.com/ijprest/keyboard-layout-editor) for providing inspiration to this project

## License

[MIT](https://choosealicense.com/licenses/mit/)
