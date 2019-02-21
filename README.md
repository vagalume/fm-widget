# Widget de estações do Vagalume.FM

O arquivo _index.html_ é o exemplo do que deve ser incorporado na página do parceiro. Realize as modificações necessárias, de forma que a chamada do _init_ tenha o ID da estação (stationID) que pode ser obtido pela URL da imagem de destaque da estação.

Já a opção _target_ é a URL que será aberta no _window.open()_ caso a pessoa clique para abrir em uma janela separada. O ideal é que o conteúdo deste widget seja armazenado em um subdiretório (ou subdomínio) de forma que os assets (img, js e css) estejam corretamente organizados.

```javascript
fmWidget.init({
    stationID: '1487264817696485', // https://vagalume.fm/carnaval/
    target: 'https://siteparceiro.com/vagalumefm/index.html'
});
```

# Dimensões

## Horizontal

Largura Mínima: 690px
Altura Mínima: 180px

# Github Mirror

Este repositório é espelhado no Github
https://github.com/vagalume/fm-widget/
